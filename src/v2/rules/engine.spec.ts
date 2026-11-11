/* eslint-disable @typescript-eslint/no-require-imports */
import { decide, finalize } from './engine';
import { RULES_VERSION } from './config';
import { isTier1, isTier2, tier1Of } from './sune';
import { req, sig } from '../../common/testing/v2-rules-helpers';
import { Decision } from './types';

const golden: {
  rows: {
    query: string;
    needs: Record<string, number>;
    emergency: { score: number; floorHit: boolean };
  }[];
} = require('./__fixtures__/golden-scores.json');

const mk = (
  id: string,
  step: number,
  values: string[],
  parameter: 'needs' | 'urgency' = 'needs',
) => ({
  id,
  type:
    parameter === 'needs'
      ? ('find_need' as const)
      : ('confirm_urgency' as const),
  level: 'orange' as const,
  importance: 'high' as const,
  reason: 'no_need' as const,
  step,
  parameter,
  stem: 's',
  options: values.map((v) => ({ value: v, label: v })),
  multiSelect: true,
  allowOther: true,
  noneOfThese: true,
});
const dec = (candidates: ReturnType<typeof mk>[]): Decision => ({
  rulesVersion: RULES_VERSION,
  emergency: { band: 'none', showHotline: false },
  cacheable: true,
  needs: [],
  boostNeeds: [],
  nx: false,
  urgency: { value: 'U-X', source: 'default', state: 'drop' },
  candidates,
  countCodes: [],
});

describe('finalize', () => {
  const counts = (total: number, byCode: Record<string, number>) => ({
    total,
    byCode,
  });
  it('strongTextMatch keeps emergency + time, drops needs', () => {
    const d = dec([
      mk('emergency', 0, ['U-0'], 'urgency'),
      mk('urgency_today', 1, ['U-1'], 'urgency'),
      mk('start', 2, ['N-HOU', 'N-FOD']),
    ]);
    const r = finalize(d, {
      counts: counts(10, { 'N-HOU': 5 }),
      strongTextMatch: true,
    });
    expect(r.questions.map((q) => q.id)).toEqual([
      'emergency',
      'urgency_today',
    ]);
  });
  it('sets counts, drops 0-count options, keeps missing-count options', () => {
    const d = dec([mk('start', 2, ['N-HOU', 'N-FOD', 'N-MON', 'N-X'])]);
    const r = finalize(d, {
      counts: counts(10, { 'N-HOU': 4, 'N-FOD': 0 }),
      strongTextMatch: false,
    });
    expect(r.questions[0].options).toEqual([
      { value: 'N-HOU', label: 'N-HOU', resultsCount: 4 },
      { value: 'N-MON', label: 'N-MON' },
      { value: 'N-X', label: 'N-X' },
    ]);
  });
  it('drops a question whose options are all equal to total', () => {
    const d = dec([mk('start', 2, ['N-HOU', 'N-FOD'])]);
    expect(
      finalize(d, {
        counts: counts(10, { 'N-HOU': 10, 'N-FOD': 10 }),
        strongTextMatch: false,
      }).questions,
    ).toEqual([]);
  });
  it('drops a question with only N-X left; total 0 drops needs', () => {
    const d = dec([mk('start', 2, ['N-HOU', 'N-X'])]);
    expect(
      finalize(d, {
        counts: counts(10, { 'N-HOU': 0 }),
        strongTextMatch: false,
      }).questions,
    ).toEqual([]);
    expect(
      finalize(d, { counts: counts(0, {}), strongTextMatch: false }).questions,
    ).toEqual([]);
  });
  it('ranks by step, caps at 3, ties by split distance then id', () => {
    const d = dec([
      mk('narrow:1', 4, ['N-FOD-01'], 'needs'),
      mk('area:N-HOU', 3, ['N-HOU-01']),
      mk('start', 2, ['N-HOU']),
      mk('urgency_today', 1, ['U-1'], 'urgency'),
    ]);
    const r = finalize(d, {
      counts: counts(10, { 'N-FOD-01': 5, 'N-HOU-01': 5, 'N-HOU': 5 }),
      strongTextMatch: false,
    });
    expect(r.questions.map((q) => q.id)).toEqual([
      'urgency_today',
      'start',
      'area:N-HOU',
    ]);
    const d2 = dec([
      mk('area:N-B', 3, ['N-HOU-01']),
      mk('area:N-A', 3, ['N-FOD-01']),
      mk('area:N-C', 3, ['N-MON-01']),
    ]);
    const r2 = finalize(d2, {
      counts: counts(10, { 'N-HOU-01': 9, 'N-FOD-01': 6, 'N-MON-01': 5 }),
      strongTextMatch: false,
    });
    expect(r2.questions.map((q) => q.id)).toEqual([
      'area:N-C',
      'area:N-A',
      'area:N-B',
    ]);
  });
  it('does not mutate the decision', () => {
    const d = dec([mk('start', 2, ['N-HOU', 'N-FOD'])]);
    const before = JSON.stringify(d);
    finalize(d, {
      counts: counts(10, { 'N-HOU': 3, 'N-FOD': 0 }),
      strongTextMatch: false,
    });
    expect(JSON.stringify(d)).toBe(before);
  });
  it('carries rulesVersion', () => {
    expect(
      finalize(dec([]), { counts: counts(1, {}), strongTextMatch: false })
        .rulesVersion,
    ).toBe(RULES_VERSION);
  });
});

describe('golden fixture', () => {
  const run = (row: (typeof golden.rows)[number]) =>
    decide(
      req(),
      sig(row.needs, {
        emergency: {
          status: 'ok',
          score: row.emergency.score,
          floorHit: row.emergency.floorHit,
        },
      }),
    );
  const row = (q: string) => golden.rows.find((r) => r.query === q);

  it('has 40 rows', () => expect(golden.rows).toHaveLength(40));

  it.each(golden.rows.map((r) => [r.query, r] as const))(
    'invariants: %s',
    (_q, r) => {
      const first = JSON.stringify(run(r));
      for (let i = 0; i < 1000; i++) expect(JSON.stringify(run(r))).toBe(first);
      const d = run(r);
      for (const q of d.candidates.filter((c) => c.parameter === 'needs')) {
        for (const o of q.options) {
          expect(d.boostNeeds).not.toContain(o.value);
          if (q.type === 'narrow' && o.value !== 'N-X') {
            expect(r.needs[o.value]).toBeGreaterThanOrEqual(0.12);
            expect(r.needs[o.value]).toBeLessThan(0.97);
          }
        }
      }
      for (const c of d.boostNeeds) {
        if (isTier1(c))
          expect(d.boostNeeds.some((x) => isTier2(x) && tier1Of(x) === c)).toBe(
            false,
          );
      }
    },
  );

  it('food bank -> no needs candidate', () => {
    const d = run(row('food bank'));
    expect(d.candidates.filter((c) => c.parameter === 'needs')).toEqual([]);
    expect(d.needs.find((n) => n.code === 'N-FOD-01').state).toBe('use');
  });
  it('mental health counseling -> area:N-MHS', () => {
    expect(
      run(row('mental health counseling')).candidates.map((c) => c.id),
    ).toEqual(['area:N-MHS']);
  });
  it('knife -> emergency popup', () => {
    const d = run(row("he has a knife and he's outside"));
    expect(d.emergency.band).toBe('popup');
    expect(d.candidates[0].id).toBe('emergency');
  });
  it('help -> start question', () => {
    expect(run(row('help')).candidates.map((c) => c.id)).toContain('start');
  });
});
