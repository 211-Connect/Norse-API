/**
 * Rewrites `evidence_input` of every row of the judge fixture
 * (src/v2/rules/__fixtures__/question-rule-judge.json) with the real `matchOf`
 * run on the saved top-20 hits and the saved org name lookup:
 *
 *   npx ts-node --transpile-only scripts/v2-match-evidence.ts <rec.jsonl.gz> <orgb.jsonl.gz>
 *
 * `rec.jsonl.gz`: one `{q, ten, total, weak, hits: [{org, oid, text}]}` per (query, tenant).
 * `orgb.jsonl.gz`: one `{q, ten, orgs: [{id, name, alt, score}]}` per (query, tenant);
 * `alt` is a string (split on ';'), a list or null. Reads files only; no network.
 * Run `scripts/v2-label-judge-grid.ts` after it.
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { gunzipSync } from 'zlib';
import { matchOf, NameCandidate } from '../src/v2/rules/match';

interface RecRow {
  q: string;
  ten: string;
  total: number | null;
  weak: boolean;
  hits: { org: string | null; oid?: string; text: string }[];
}
interface OrgRow {
  q: string;
  ten: string;
  orgs: {
    id: string;
    name: string | null;
    alt: string | string[] | null;
  }[];
}

const lines = <T>(file: string): T[] =>
  gunzipSync(readFileSync(file))
    .toString('utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as T);

const [recFile, orgbFile] = process.argv.slice(2);
if (!recFile || !orgbFile) {
  console.error('usage: v2-match-evidence.ts <rec.jsonl.gz> <orgb.jsonl.gz>');
  process.exit(1);
}
const key = (q: string, t: string) => `${q}|${t}`;
const rec = new Map(
  lines<RecRow & { err?: unknown }>(recFile)
    .filter((r) => !r.err)
    .map((r) => [key(r.q, r.ten), r]),
);
const orgb = new Map(
  lines<OrgRow>(orgbFile).map((r) => [key(r.q.toLowerCase().trim(), r.ten), r]),
);

const alternates = (alt: string | string[] | null): string[] =>
  (Array.isArray(alt) ? alt.join(';') : (alt ?? ''))
    .split(';')
    .map((a) => a.trim())
    .filter((a) => a.length > 0);

const file = resolve(
  __dirname,
  '../src/v2/rules/__fixtures__/question-rule-judge.json',
);
const rows = JSON.parse(readFileSync(file, 'utf8'));
let missing = 0;
let named = 0;
let generic = 0;
for (const row of rows) {
  const r = rec.get(key(row.query, row.tenant));
  if (!r) {
    missing++;
    console.error(`no recording for a row (${row.label})`);
    continue;
  }
  const ob = orgb.get(key(row.query.toLowerCase().trim(), row.tenant));
  const names: NameCandidate[] = (ob?.orgs ?? [])
    .filter((o) => o.id && o.name)
    .map((o) => ({
      id: o.id,
      name: o.name as string,
      alternate_names: alternates(o.alt),
    }));
  const m = matchOf({
    words: row.content_words,
    hits: r.hits.map((h) => ({ org_name: h.org, text: h.text })),
    names,
  });
  row.evidence_input = {
    weak: r.weak,
    total: r.total,
    hit_count: r.hits.length,
    org_share: m.org_share,
    top_org_share: m.top_org_share,
    top_org_back: m.top_org_back,
    text_share: m.text_share,
    words_held: m.words_held,
    named: m.named,
    generic: m.generic,
  };
  if (m.named) named++;
  if (m.generic) generic++;
}
if (missing > 0) {
  console.error(`${missing} rows have no recording; fixture not written`);
  process.exit(1);
}
writeFileSync(file, JSON.stringify(rows));
console.log(
  `evidence for ${rows.length} rows; named ${named}, generic ${generic}`,
);
