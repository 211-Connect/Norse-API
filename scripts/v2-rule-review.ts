/**
 * Writes the rule review page (Markdown) from the judge fixture by running
 * the real rule code on the saved rows: 10 rows per rule R1-R5.
 *
 *   npx ts-node --transpile-only scripts/v2-rule-review.ts > rule-review.md
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { decide, finalize, gridRule } from '../src/v2/rules/engine';
import { matchFromShares } from '../src/v2/rules/match';

const rows = JSON.parse(
  readFileSync(
    resolve(__dirname, '../src/v2/rules/__fixtures__/question-rule-judge.json'),
    'utf8',
  ),
);
const PER_RULE = 10;
const TENANT = { WA: 'WA_211', IL: 'IL211', NY: 'Rochester NY' } as Record<
  string,
  string
>;

/** Same test as `meets` in question-rule-judge.spec.ts. */
function meets(label: string, qs: any[]): boolean {
  const all = qs.map((q) => q.id);
  const need = qs.filter((q) => q.type === 'find_need').map((q) => q.id);
  switch (label) {
    case 'ASK_AREA':
      return need.includes('spread') || need.includes('start');
    case 'COMMON':
      return need.length > 0;
    case 'NO_SPREAD':
    case 'NAME_NOT_HELD':
    case 'NONSENSE':
      return !need.includes('spread');
    case 'NAME_HELD':
      return need.length === 0;
    case 'PROGRAM':
      return !need.includes('spread') && !need.includes('start');
    case 'EMERGENCY_FIRST':
      return all[0] === 'emergency';
    default:
      return need.includes('start') || need.includes('no_match');
  }
}

function run(row: any) {
  const e = row.evidence_input;
  const req = {
    has_text: true,
    has_content_word: row.content_words.length > 0,
    query: row.query,
    content_words: row.content_words,
    needs: [],
    passed_needs: [],
    clarify: 'auto' as const,
  };
  const decision = decide(
    req,
    {
      needs: { status: 'ok', scores: row.scores },
      emergency: {
        status: 'ok',
        score: row.emergency_live ? 0.9 : 0,
        floor_hit: false,
        calm_context: false,
        dv_shelter: false,
      },
    } as any,
    {},
  );
  const input = {
    counts: { total: e.total, by_code: null },
    strong_text_match: false,
    match: matchFromShares({
      words: row.content_words,
      hit_count: e.hit_count,
      org_share: e.org_share,
      top_org_share: e.top_org_share,
      top_org_back: e.top_org_back,
      text_share: e.text_share,
      words_held: e.words_held,
      named: e.named,
      generic: e.generic,
    }),
    weak: e.weak,
  };
  const rule = gridRule(decision, input);
  const out = finalize(decision, input);
  return { decision, input, rule, out, ok: meets(row.label, out.questions) };
}

const results = rows.map((row: any) => ({ row, ...run(row) }));
const pct = (n: number) => `${Math.round(n * 100)}%`;
const top = (scores: Record<string, number>) =>
  Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k} ${v.toFixed(2)}`)
    .join(', ');

const lines: string[] = [];
lines.push('# Rule review: question rule grid R1-R5\n');
lines.push(
  'Source: `src/v2/rules/__fixtures__/question-rule-judge.json` (249 saved live rows, 2026-11-23), run through the real `decide` + `finalize`. Mark each row right or wrong in the last column. "Label" is Claude\'s judge label, not Lucas\'s.\n',
);
lines.push(
  'Grid: cell = need level (unclear / area / kind) x match (concentrated / spread / none). R1 name matches; R2 kind clear; R3 area clear; R4 nothing clear, hits match words; R5 nothing clear, hits do not match words.\n',
);
for (const rule of ['R1', 'R2', 'R3', 'R4', 'R5']) {
  const all = results.filter((r: any) => r.rule === rule);
  // Spread over tenants and labels: failing rows first (3), then round-robin by tenant.
  const picked: any[] = [];
  const seenKey = new Set<string>();
  const add = (r: any) => {
    const k = `${r.row.q}|${r.row.tenant}`;
    if (!seenKey.has(k) && picked.length < PER_RULE) {
      seenKey.add(k);
      picked.push(r);
    }
  };
  all
    .filter((r: any) => !r.ok)
    .slice(0, 3)
    .forEach(add);
  const byTenant = ['WA', 'IL', 'NY'].map((t) =>
    all.filter((r: any) => r.row.tenant === t),
  );
  for (let i = 0; picked.length < PER_RULE && i < 40; i++)
    byTenant.forEach(
      (g) =>
        g[Math.floor((i * g.length) / 10)] &&
        add(g[Math.floor((i * g.length) / 10)]),
    );
  all.forEach(add);
  lines.push(`## ${rule} (${all.length} rows in the fixture)\n`);
  lines.push(
    '| # | Query | Tenant | Top need scores | org / top-org / text share | Cell | Page shows | Label (ok?) | Right? |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|');
  picked.forEach((r, i) => {
    const e = r.row.evidence_input;
    const qs = r.out.questions
      .map(
        (q: any) =>
          `${q.id}: "${q.stem}" [${q.options
            .slice(0, 4)
            .map((o: any) => o.label)
            .join(' / ')}]`,
      )
      .join('<br>');
    const page = [
      qs || 'no question',
      r.out.notice ? `notice: "${r.out.notice.text}"` : '',
      r.out.phone_line ? `phone: ${r.out.phone_line.number}` : '',
    ]
      .filter(Boolean)
      .join('<br>');
    const cell = `${r.decision.need_level} x ${r.input.match}${e.weak || e.total === 0 ? ' (no results)' : ''}`;
    lines.push(
      `| ${rule}.${i + 1} | ${r.row.q} | ${TENANT[r.row.tenant]} | ${top(r.row.scores)} | ${pct(e.org_share)} / ${pct(e.top_org_share)} / ${pct(e.text_share)} | ${cell} | ${page.replace(/\|/g, '/')} | ${r.row.label} (${r.ok ? 'ok' : 'FAIL'}) |  |`,
    );
  });
  lines.push('');
}
console.log(lines.join('\n'));
