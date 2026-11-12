/* eslint-disable @typescript-eslint/no-require-imports */
import { decide, finalize } from './engine';
import { RULES_VERSION } from './config';
import { BAND_BASE } from './importance';
import { isTier1, isTier2, tier1Of } from './sune';
import { req, sig } from '../../common/testing/v2-rules-helpers';
import { Decision } from './types';

const golden: {
  rows: {
    query: string;
    needs: Record<string, number>;
    emergency: { score: number; floor_hit: boolean };
  }[];
} = require('./__fixtures__/golden-scores.json');

const mk = (
  id: string,
  step: number,
  values: string[],
  parameter: 'needs' | 'urgency' = 'needs',
  uncertainty = 0.5,
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
  multi_select: true,
  allow_other: true,
  none_of_these: true,
  value: 0,
  priority: 0,
  uncertainty,
});
const dec = (
  candidates: ReturnType<typeof mk>[],
  option_scores: Record<string, number> = {},
): Decision => ({
  rules_version: RULES_VERSION,
  option_scores,
  emergency: { band: 'none', show_hotline: false },
  cacheable: true,
  needs: [],
  boost_needs: [],
  nx: false,
  urgency: { value: 'U-X', source: 'default', state: 'drop' },
  candidates,
  count_codes: [],
});

describe('finalize', () => {
  const counts = (total: number, by_code: Record<string, number> | null) => ({
    total,
    by_code,
  });
  it('strong_text_match keeps emergency + time, drops needs', () => {
    const d = dec([
      mk('emergency', 0, ['U-0'], 'urgency'),
      mk('urgency_today', 1, ['U-1'], 'urgency'),
      mk('start', 2, ['N-HOU', 'N-FOD']),
    ]);
    const r = finalize(d, {
      counts: counts(10, { 'N-HOU': 5 }),
      strong_text_match: true,
    });
    expect(r.questions.map((q) => q.id)).toEqual([
      'emergency',
      'urgency_today',
    ]);
  });
  it('sets counts and drops 0-count options; a code missing from counted by_code is 0', () => {
    // An Elasticsearch aggregation can leave out a code with no matches, so a
    // missing key in a counted by_code means 0 results, not "unknown".
    const d = dec([mk('start', 2, ['N-HOU', 'N-FOD', 'N-MON', 'N-X'])]);
    const r = finalize(d, {
      counts: counts(10, { 'N-HOU': 4, 'N-FOD': 0 }),
      strong_text_match: false,
    });
    expect(r.questions[0].options).toEqual([
      { value: 'N-HOU', label: 'N-HOU', results_count: 4 },
      { value: 'N-X', label: 'N-X' },
    ]);
  });
  it('recomputes uncertainty over the options left after 0-count drops', () => {
    // Housing and Food are a toss-up (uncertainty ~0.80). With Food at 0
    // results the question is Housing vs Money, which the model favours
    // clearly: normEntropy([0.4, 0.05]) ~0.503.
    const d = dec([mk('start', 2, ['N-HOU', 'N-FOD', 'N-MON'], 'needs', 0.8)], {
      'N-HOU': 0.4,
      'N-FOD': 0.4,
      'N-MON': 0.05,
    });
    const [q] = finalize(d, {
      counts: counts(10, { 'N-HOU': 5, 'N-FOD': 0, 'N-MON': 5 }),
      strong_text_match: false,
    }).questions;
    expect(q.options.map((o) => o.value)).toEqual(['N-HOU', 'N-MON']);
    expect(q.uncertainty).toBeCloseTo(0.503, 2);
  });
  it('a start question cut to one option ranks below a real area question', () => {
    const d = dec(
      [
        mk('start', 2, ['N-HOU', 'N-FOD', 'N-MON'], 'needs', 0.8),
        mk('area:N-HOU', 3, ['N-HOU-01', 'N-HOU-02'], 'needs', 0.6),
      ],
      {
        'N-HOU': 0.4,
        'N-FOD': 0.4,
        'N-MON': 0.05,
        'N-HOU-01': 0.5,
        'N-HOU-02': 0.5,
      },
    );
    const qs = finalize(d, {
      counts: counts(10, {
        'N-HOU': 5,
        'N-FOD': 0,
        'N-MON': 0,
        'N-HOU-01': 5,
        'N-HOU-02': 5,
      }),
      strong_text_match: false,
    }).questions;
    expect(qs.map((q) => q.id)).toEqual(['area:N-HOU', 'start']);
    expect(qs[1].uncertainty).toBe(0);
  });
  it('keeps the decide-time uncertainty when no option was dropped', () => {
    const d = dec([mk('start', 2, ['N-HOU', 'N-FOD'], 'needs', 0.42)]);
    const [q] = finalize(d, {
      counts: counts(10, { 'N-HOU': 5, 'N-FOD': 5 }),
      strong_text_match: false,
    }).questions;
    expect(q.uncertainty).toBe(0.42);
  });
  it('by_code null (not counted) keeps every option, without counts', () => {
    const d = dec([mk('start', 2, ['N-HOU', 'N-FOD', 'N-X'])]);
    const r = finalize(d, {
      counts: counts(10, null),
      strong_text_match: false,
    });
    expect(r.questions[0].options).toEqual([
      { value: 'N-HOU', label: 'N-HOU' },
      { value: 'N-FOD', label: 'N-FOD' },
      { value: 'N-X', label: 'N-X' },
    ]);
  });
  it('an empty counted by_code drops every need option (all 0), unlike null', () => {
    const d = dec([mk('start', 2, ['N-HOU', 'N-FOD'])]);
    expect(
      finalize(d, { counts: counts(10, {}), strong_text_match: false })
        .questions,
    ).toEqual([]);
    expect(
      finalize(d, { counts: counts(10, null), strong_text_match: false })
        .questions,
    ).toHaveLength(1);
  });
  it('drops a question whose options are all equal to total', () => {
    const d = dec([mk('start', 2, ['N-HOU', 'N-FOD'])]);
    expect(
      finalize(d, {
        counts: counts(10, { 'N-HOU': 10, 'N-FOD': 10 }),
        strong_text_match: false,
      }).questions,
    ).toEqual([]);
  });
  it('drops a question with only N-X left; total 0 drops needs', () => {
    const d = dec([mk('start', 2, ['N-HOU', 'N-X'])]);
    expect(
      finalize(d, {
        counts: counts(10, { 'N-HOU': 0 }),
        strong_text_match: false,
      }).questions,
    ).toEqual([]);
    expect(
      finalize(d, { counts: counts(0, {}), strong_text_match: false })
        .questions,
    ).toEqual([]);
  });
  it('ranks by priority, caps at 3', () => {
    const d = dec([
      mk('narrow:1', 4, ['N-FOD-01'], 'needs', 0.1),
      mk('area:N-HOU', 3, ['N-HOU-01'], 'needs', 0.6),
      mk('start', 2, ['N-HOU'], 'needs', 0.9),
      mk('urgency_today', 1, ['U-1'], 'urgency', 0.3),
    ]);
    const r = finalize(d, {
      counts: counts(10, { 'N-FOD-01': 5, 'N-HOU-01': 5, 'N-HOU': 5 }),
      strong_text_match: false,
    });
    expect(r.questions.map((q) => q.id)).toEqual([
      'start',
      'area:N-HOU',
      'urgency_today',
    ]);
    const d2 = dec([
      mk('area:N-B', 3, ['N-HOU-01']),
      mk('area:N-A', 3, ['N-FOD-01']),
      mk('area:N-C', 3, ['N-MON-01']),
    ]);
    const r2 = finalize(d2, {
      counts: counts(10, { 'N-HOU-01': 9, 'N-FOD-01': 6, 'N-MON-01': 5 }),
      strong_text_match: false,
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
      strong_text_match: false,
    });
    expect(JSON.stringify(d)).toBe(before);
  });
  it('carries rules_version', () => {
    expect(
      finalize(dec([]), { counts: counts(1, {}), strong_text_match: false })
        .rules_version,
    ).toBe(RULES_VERSION);
  });
});

describe('numeric order', () => {
  const tier1Area = {
    'N-HOU': 0.95,
    'N-HOU-01': 0.4,
    'N-HOU-02': 0.4,
    'N-HOU-03': 0.4,
  };
  const withUrgency = (scores: Record<string, number>, u: number) =>
    sig(scores, {
      needs: {
        status: 'ok',
        scores,
      },
      urgency: { level: 'U-1', score: u },
    });
  const run = (signals: ReturnType<typeof sig>) =>
    finalize(decide(req(), signals), {
      counts: { total: 100, by_code: null },
      strong_text_match: false,
    }).questions;

  it('a near-equal area question ranks before urgency_today', () => {
    const ids = run(withUrgency(tier1Area, 0.9)).map((q) => q.id);
    expect(ids).toContain('urgency_today');
    expect(ids.indexOf('area:N-HOU')).toBeLessThan(
      ids.indexOf('urgency_today'),
    );
  });
  it('a low-entropy area question ranks after urgency_today', () => {
    const ids = run(
      withUrgency(
        {
          'N-HOU': 0.95,
          'N-HOU-01': 0.45,
          'N-HOU-02': 0.01,
          'N-HOU-03': 0.01,
        },
        0.85,
      ),
    ).map((q) => q.id);
    expect(ids.indexOf('urgency_today')).toBeLessThan(
      ids.indexOf('area:N-HOU'),
    );
  });
  it('the result split changes the order', () => {
    const d = dec([
      mk('area:N-A', 3, ['N-HOU-01']),
      mk('area:N-B', 3, ['N-FOD-01']),
    ]);
    const r = finalize(d, {
      counts: { total: 100, by_code: { 'N-HOU-01': 1, 'N-FOD-01': 50 } },
      strong_text_match: false,
    });
    expect(r.questions.map((q) => q.id)).toEqual(['area:N-B', 'area:N-A']);
  });
  it('emergency stays first with a high-value area question present', () => {
    const signals = withUrgency(tier1Area, 0.9);
    signals.emergency = { status: 'ok', score: 0.9, floor_hit: false };
    const qs = run(signals);
    expect(qs[0].id).toBe('emergency');
    expect(qs.map((q) => q.id)).toContain('area:N-HOU');
  });
  it('priority is the band base plus value for every question', () => {
    for (const row of golden.rows) {
      const signals = sig(row.needs, {
        needs: {
          status: 'ok',
          scores: row.needs,
        },
        urgency: { level: 'U-1', score: 0.85 },
        emergency: {
          status: 'ok',
          score: row.emergency.score,
          floor_hit: row.emergency.floor_hit,
        },
      });
      for (const q of run(signals)) {
        expect(q.value).toBeGreaterThanOrEqual(0);
        expect(q.value).toBeLessThanOrEqual(0.999);
        expect(q.priority).toBeCloseTo(BAND_BASE[q.importance] + q.value, 3);
      }
    }
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
          floor_hit: row.emergency.floor_hit,
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
          expect(d.boost_needs).not.toContain(o.value);
          if (q.type === 'narrow' && o.value !== 'N-X') {
            expect(r.needs[o.value]).toBeGreaterThanOrEqual(0.12);
            expect(r.needs[o.value]).toBeLessThan(0.97);
          }
        }
      }
      for (const c of d.boost_needs) {
        if (isTier1(c))
          expect(
            d.boost_needs.some((x) => isTier2(x) && tier1Of(x) === c),
          ).toBe(false);
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
  it('NaN emergency score -> unknown band, not cacheable', () => {
    const d = decide(
      req(),
      sig({}, { emergency: { status: 'ok', score: NaN, floor_hit: false } }),
    );
    expect(d.emergency.band).toBe('unknown');
    expect(d.cacheable).toBe(false);
  });
});

describe('non-finite need scores read as no score', () => {
  it('an Infinity need score is not used, boosted or offered', () => {
    const d = decide(req(), sig({ 'N-FOD-01': Infinity, 'N-HOU-01': 0.5 }));
    expect(d.needs.map((n) => n.code)).not.toContain('N-FOD-01');
    expect(d.boost_needs).not.toContain('N-FOD-01');
    expect(d.count_codes).not.toContain('N-FOD-01');
    for (const n of d.needs) {
      if (n.confidence !== undefined) {
        expect(Number.isFinite(n.confidence)).toBe(true);
      }
    }
    for (const s of Object.values(d.option_scores)) {
      expect(Number.isFinite(s)).toBe(true);
    }
  });
  it('a NaN Tier 2 score does not hide a real Tier 2 from the area rule', () => {
    // N-HOU-01 at 0.8 is above the area rule's Tier 2 cap (0.5), so the rule
    // must not fire; a NaN elsewhere must not turn the max into NaN.
    const d = decide(
      req(),
      sig({ 'N-HOU': 0.95, 'N-HOU-01': 0.8, 'N-FOD-01': NaN }),
    );
    expect(d.candidates.map((c) => c.reason)).not.toContain('area_only');
  });
  it('a NaN Tier 1 score never wins the starting areas', () => {
    const d = decide(req(), sig({ 'N-HOU': NaN, 'N-FOD': 0.6 }));
    const start = d.candidates.find((c) => c.id === 'start');
    expect(start?.options[0].value).toBe('N-FOD');
  });
});
