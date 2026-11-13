/* eslint-disable @typescript-eslint/no-require-imports */
import { decide, finalize } from './engine';
import { req } from '../../common/testing/v2-rules-helpers';
import { Question, RulesSignals } from './types';

/**
 * Question-order gold set (ISS-2697, rules engine).
 *
 * Fixture: 459 real, de-identified test queries (query text only, no user id),
 * each with the saved ml-broker scores (needs, urgency, emergency; Hydra
 * R4N-cal, ml-broker search-classification route, saved 2026-11-11) and the
 * acceptable question sequences from the answer key. The test calls no
 * service. Every option count is 10 of 100 and strong_text_match is false,
 * as in the measurement run.
 *
 * The answer key is a draft. Lucas has not reviewed it yet. Rows #33
 * (careerlink berks), #38 (night shelters) and #40 (marianna pennsylvania) are
 * "key too strict" candidates: they stay as they are until he decides.
 *
 * MIN_PASS is the measured count on development. Raise it when the engine or
 * the models improve; a drop means the rules got worse (or the key changed).
 */
const MIN_PASS = 378;

interface Want {
  t: string;
  offer?: string[];
}
type Acc = {
  first?: string;
  needs_urgency_used?: string;
  uses_one_of?: string[];
  seq?: Want[];
};
interface Row {
  i: number;
  stratum: string;
  query: string;
  scores: Record<string, number>;
  nx: number;
  urgency: { level: 'U-1' | 'U-2' | 'U-3' | 'U-4'; score: number };
  emergency: {
    score: number;
    floor_hit: boolean;
    calm_context: boolean;
    dv_shelter: boolean;
  };
  acceptable: Acc[];
}
const fixture: { rows: Row[] } = require('./__fixtures__/gold-set.json');

const tok = (q: Question): string => {
  if (q.id === 'emergency') return 'emergency';
  if (q.id === 'urgency_today') return 'today';
  if (q.id === 'urgency_time') return 'time';
  if (q.id === 'start') return 'start';
  if (q.id.startsWith('area:')) return q.id;
  return 'narrow';
};
const itemOk = (w: Want, q: Question): boolean =>
  w.t === tok(q) &&
  (!w.offer || w.offer.some((c) => q.options.some((o) => o.value === c)));

function run(row: Row) {
  const signals: RulesSignals = {
    needs: { status: 'ok', scores: { ...row.scores, 'N-X': row.nx } },
    urgency: row.urgency,
    emergency: { status: 'ok', ...row.emergency },
  };
  const decision = decide(req({ has_text: true }), signals, {});
  const byCode: Record<string, number> = {};
  for (const c of decision.count_codes) byCode[c] = 10;
  const clar = finalize(decision, {
    counts: { total: 100, by_code: byCode },
    strong_text_match: false,
  });
  return { decision, questions: clar.questions };
}

function matches(acc: Acc, out: ReturnType<typeof run>): boolean {
  const qs = out.questions;
  if (acc.first !== undefined) return qs.length > 0 && tok(qs[0]) === acc.first;
  if (acc.needs_urgency_used !== undefined) {
    const u = out.decision.urgency;
    if (!(u.state === 'use' && u.value === acc.needs_urgency_used))
      return false;
  }
  if (acc.uses_one_of) {
    const used = acc.uses_one_of;
    if (
      !out.decision.needs.some(
        (n) => n.state === 'use' && used.includes(n.code),
      )
    )
      return false;
  }
  const seq = acc.seq ?? [];
  if (seq.length === qs.length && seq.every((w, k) => itemOk(w, qs[k])))
    return true;
  // A late narrow question (step >= 7, after a sure need) at the end is fine.
  const last = qs[qs.length - 1];
  if (last && last.step >= 7 && tok(last) === 'narrow') {
    const rest = qs.slice(0, -1);
    return (
      seq.length === rest.length && seq.every((w, k) => itemOk(w, rest[k]))
    );
  }
  return false;
}

describe('question-order gold set (459 real queries, saved scores)', () => {
  const results = fixture.rows.map((row) => {
    const out = run(row);
    return { row, out, ok: row.acceptable.some((a) => matches(a, out)) };
  });
  const pass = results.filter((r) => r.ok).length;

  it('has 459 unique queries', () => {
    expect(fixture.rows).toHaveLength(459);
    expect(new Set(fixture.rows.map((r) => r.query)).size).toBe(459);
  });

  it(`passes at least ${MIN_PASS} of 459`, () => {
    console.log(`gold set: ${pass} of ${results.length} pass`);
    expect(pass).toBeGreaterThanOrEqual(MIN_PASS);
  });

  it('emergency rows always get the emergency question first', () => {
    const bad = results.filter(
      (r) =>
        r.out.decision.emergency.band === 'popup' &&
        r.out.questions[0]?.id !== 'emergency',
    );
    expect(bad.map((r) => r.row.query)).toEqual([]);
  });

  it('never asks more than 3 questions', () => {
    expect(results.filter((r) => r.out.questions.length > 3)).toEqual([]);
  });
});
