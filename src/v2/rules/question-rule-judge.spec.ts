/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Judge spec for the one question rule (rules-signals-2026-11-23.md 4.10 Q4,
 * Lucas 2026-11-23): labeled queries per tenant, the gold set stays a floor.
 *
 * Each fixture row is one live call on the prod index (read-only), recorded on
 * 2026-11-23 (need scores) and 2026-11-24 (match inputs: hits read, words held,
 * named by the keyword list) on branch build, local server, for WA_211, IL211
 * and Rochester NY with coords. Scores under 0.001 are left out (no cutoff is
 * that low). Labels are Claude's, for Lucas to review
 * (WORK-LOG/HANDOFF-ASSETS/v2-search--rules-engine/question-rule-v1/labels.md).
 *
 * The spec runs the real decide + matchValue + finalize on the saved
 * inputs, so a rule or cutoff change is judged without a live call. The
 * emergency signal is not recorded: crisis rows carry `emergency_live` (the
 * live response had the danger question) and get a popup-band score.
 */
import { decide, finalize, gridRule } from './engine';
import * as legacy from './legacy';
import { Match, matchValue } from './match';
import { FinalizeInput, GridRule, Question, RulesSignals } from './types';

type Label =
  | 'ASK_AREA'
  | 'NO_SPREAD'
  | 'NAME_HELD'
  | 'NAME_NOT_HELD'
  | 'PROGRAM'
  | 'COMMON'
  | 'EMERGENCY_FIRST'
  | 'NONSENSE'
  | 'LOCATION';

interface Row {
  q: string;
  tenant: 'WA' | 'IL' | 'NY';
  label: Label;
  src: string;
  scores: Record<string, number>;
  query: string;
  content_words: string[];
  emergency_live: boolean;
  /** Grid fields, written by scripts/v2-label-judge-grid.ts. */
  need: 'unclear' | 'area' | 'likely' | 'kind';
  match: Match;
  results: 'none' | 'some';
  rule: GridRule;
  evidence_input: {
    weak: boolean;
    total: number | null;
    hit_count: number;
    words_held: boolean;
    named: boolean;
  };
}

const rows: Row[] = require('./__fixtures__/question-rule-judge.json');

/**
 * Floor: the measured pass count on 2026-11-24 (like MIN_PASS of the gold set).
 * 208 on the 11-23 inputs. Now 'cocoon house' and 'catholic charities' (WA) have
 * no service inside the radius, so the grid runs (by design); 'neighborcare' (WA)
 * lost the removed one-org share test; 'testing center' (WA) has other live hits.
 */
const MIN_PASS = 204;

const ids = (qs: Question[]) => qs.map((q) => q.id);
const needIds = (qs: Question[]) =>
  qs.filter((q) => q.type === 'find_need').map((q) => q.id);

/** Whether the questions meet the label. */
export function meets(label: Label, qs: Question[]): boolean {
  const all = ids(qs);
  const need = needIds(qs);
  switch (label) {
    case 'ASK_AREA':
      return need.includes('spread') || need.includes('start');
    case 'COMMON':
      return need.length > 0;
    case 'NO_SPREAD':
    case 'NAME_NOT_HELD':
      return !need.includes('spread');
    case 'NAME_HELD':
      return need.length === 0;
    case 'PROGRAM':
      return !need.includes('spread') && !need.includes('start');
    case 'NONSENSE':
      // The root question (start or no_match) is right; never a spread.
      return !need.includes('spread');
    case 'EMERGENCY_FIRST':
      return all[0] === 'emergency';
    case 'LOCATION':
      return need.includes('start') || need.includes('no_match');
  }
}

function signalsOf(row: Row): RulesSignals {
  return {
    needs: { status: 'ok', scores: row.scores },
    emergency: {
      status: 'ok',
      score: row.emergency_live ? 0.9 : 0,
      floor_hit: false,
      calm_context: false,
      dv_shelter: false,
    },
  };
}

const reqOf = (row: Row) => ({
  has_text: true,
  has_content_word: row.content_words.length > 0,
  query: row.query,
  content_words: row.content_words,
  needs: [],
  passed_needs: [],
  clarify: 'auto' as const,
});

/** Development's engine (the V2_QUESTION_RULE_V1=off path) on the same rows. */
function runLegacy(row: Row): Question[] {
  const d = legacy.decide(reqOf(row), signalsOf(row) as never, {});
  return legacy.finalize(d, {
    counts: { total: row.evidence_input.total, by_code: null },
    strong_text_match: false,
  }).questions as unknown as Question[];
}

const inputOf = (row: Row): FinalizeInput => {
  const e = row.evidence_input;
  return {
    // Untagged prod index: counts are not counted (null).
    counts: { total: e.total, by_code: null },
    strong_text_match: false,
    match: matchValue({
      words: row.content_words,
      hit_count: e.hit_count,
      words_held: e.words_held,
      named: e.named,
    }),
    weak: e.weak,
  };
};

/** Only blocking questions (importance high or critical) count as asked. */
function run(row: Row): Question[] {
  const decision = decide(reqOf(row), signalsOf(row), {});
  return finalize(decision, inputOf(row)).questions.filter(
    (q) => q.importance === 'high' || q.importance === 'critical',
  );
}

describe('question rule judge spec (labeled per-tenant rows)', () => {
  const results = rows.map((row) => ({ row, ok: meets(row.label, run(row)) }));
  const passed = results.filter((r) => r.ok).length;

  it(`passes at least ${MIN_PASS} of ${rows.length} rows`, () => {
    const legacyPass = rows.filter((r) => meets(r.label, runLegacy(r))).length;
    console.log(`judge baseline: development ${legacyPass}`);
    const fails = results
      .filter((r) => !r.ok)
      .map((r) => `${r.row.label} ${r.row.q}/${r.row.tenant}`);

    console.log(
      `judge spec: ${passed} of ${rows.length}; fails: ${fails.join(', ')}`,
    );
    expect(passed).toBeGreaterThanOrEqual(MIN_PASS);
  });

  it('the grid rule of every row equals the labeled rule', () => {
    const wrong = rows.filter(
      (r) =>
        gridRule(decide(reqOf(r), signalsOf(r), {}), inputOf(r)) !== r.rule,
    );
    expect(wrong.map((r) => `${r.q}/${r.tenant}`)).toEqual([]);
  });

  it.each([
    'ASK_AREA',
    'NO_SPREAD',
    'NAME_HELD',
    'NAME_NOT_HELD',
    'PROGRAM',
    'COMMON',
    'EMERGENCY_FIRST',
    'NONSENSE',
    'LOCATION',
  ] as Label[])('has rows labeled %s', (label) => {
    expect(rows.some((r) => r.label === label)).toBe(true);
  });

  it('every crisis row puts the danger question first', () => {
    for (const r of results.filter((x) => x.row.label === 'EMERGENCY_FIRST'))
      expect(r.ok).toBe(true);
  });
});
