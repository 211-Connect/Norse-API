/**
 * Adds the grid fields to every row of the judge fixture
 * (src/v2/rules/__fixtures__/question-rule-judge.json): `need` (need level of
 * decide), `match` (matchValue), `results` ('none' when weak or total 0,
 * else 'some') and `rule` (gridRule). Run it for NEW rows only: for a rule that
 * changes on an existing row, list the change and its reason in the spec
 * (CHANGED_RULES), so the fixture stays a record and not a copy of the code.
 *
 *   npx ts-node --transpile-only scripts/v2-label-judge-grid.ts
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { decide, gridRule } from '../src/v2/rules/engine';
import { matchValue } from '../src/v2/rules/match';

const file = resolve(
  __dirname,
  '../src/v2/rules/__fixtures__/question-rule-judge.json',
);
const rows = JSON.parse(readFileSync(file, 'utf8'));
const counts: Record<string, number> = {};
for (const row of rows) {
  const e = row.evidence_input;
  const decision = decide(
    {
      has_text: true,
      has_content_word: row.content_words.length > 0,
      query: row.query,
      content_words: row.content_words,
      needs: [],
      passed_needs: [],
      clarify: 'auto',
    },
    {
      needs: { status: 'ok', scores: row.scores },
      emergency: {
        status: 'ok',
        score: row.emergency_live ? 0.9 : 0,
        floor_hit: false,
        calm_context: false,
        dv_shelter: false,
      },
    },
    {},
  );
  row.need = decision.need_level;
  row.match = matchValue({
    words: row.content_words,
    hit_count: e.hit_count,
    words_held: e.words_held,
    named: e.named,
  });
  row.results = e.weak || e.total === 0 ? 'none' : 'some';
  row.rule = gridRule(decision, {
    counts: { total: e.total, by_code: null },
    strong_text_match: false,
    match: row.match,
    weak: e.weak,
  });
  counts[row.rule] = (counts[row.rule] ?? 0) + 1;
}
writeFileSync(file, JSON.stringify(rows));
console.log(`labeled ${rows.length} rows`, JSON.stringify(counts));
