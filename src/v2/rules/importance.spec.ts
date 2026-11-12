import { sig } from '../../common/testing/v2-rules-helpers';
import {
  BAND_BASE,
  effort,
  normEntropy,
  priorityOf,
  splitQuality,
  uncertainty,
  valueOf,
  yesNo,
} from './importance';
import { Question } from './types';

const q = (
  id: string,
  type: Question['type'],
  values: string[],
  counts: (number | undefined)[] = [],
): Question => ({
  id,
  type,
  level: 'orange',
  importance: 'high',
  reason: 'no_need',
  step: 1,
  parameter: type === 'find_need' || type === 'narrow' ? 'needs' : 'urgency',
  stem: 's',
  options: values.map((v, i) => ({
    value: v,
    label: v,
    ...(counts[i] === undefined ? {} : { results_count: counts[i] }),
  })),
  multi_select: true,
  allow_other: true,
  none_of_these: true,
  value: 0,
  priority: 0,
  uncertainty: 0,
});

describe('yesNo', () => {
  it('peaks at 0.5', () => {
    expect(yesNo(0)).toBe(0);
    expect(yesNo(0.5)).toBe(1);
    expect(yesNo(0.9)).toBeCloseTo(0.36);
  });
  it('clamps out of range', () => {
    expect(yesNo(-3)).toBe(0);
    expect(yesNo(7)).toBe(0);
  });
});

describe('normEntropy', () => {
  it('edge cases', () => {
    expect(normEntropy([])).toBe(0);
    expect(normEntropy([1])).toBe(0);
    expect(normEntropy([0, 0, 0])).toBe(1);
    expect(normEntropy([1, 1, 1])).toBeCloseTo(1);
    expect(normEntropy([1, 0, 0])).toBe(0);
    expect(normEntropy([0.9, 0.1])).toBeCloseTo(0.469, 3);
  });
  it('drops non-finite values and clamps negatives', () => {
    expect(normEntropy([NaN, 1])).toBe(0);
    expect(normEntropy([-1, 1, 1])).toBeCloseTo(Math.log(2) / Math.log(3));
  });
});

describe('effort', () => {
  it('falls with the option count, floor 0.8', () => {
    const e = (n: number) =>
      effort(
        q(
          'start',
          'find_need',
          Array.from({ length: n }, (_, i) => `N-${i}`),
        ),
      );
    expect(e(2)).toBe(1);
    expect(e(3)).toBeCloseTo(0.95);
    expect(e(4)).toBeCloseTo(0.9);
    expect(e(6)).toBeCloseTo(0.8);
    expect(e(8)).toBeCloseTo(0.8);
  });
});

describe('splitQuality', () => {
  const sq = (counts: number[], total: number) =>
    splitQuality(
      q(
        'start',
        'find_need',
        counts.map((_, i) => `N-${i}`),
        counts,
      ),
      total,
    );
  it('is 1 without counts or total', () => {
    expect(splitQuality(q('start', 'find_need', ['a', 'b']), 100)).toBe(1);
    expect(sq([50], 0)).toBe(1);
  });
  it('one counted option: rewards a half split of the total', () => {
    expect(sq([50], 100)).toBe(1);
    expect(sq([10], 100)).toBeCloseTo(0.2);
    expect(sq([100], 100)).toBe(0);
  });
  it('several counted options: even counts give 1', () => {
    // Regression: the old yes/no formula gave 0.2 for the first case.
    expect(sq([10, 10, 10, 10], 100)).toBeCloseTo(1);
    expect(sq([10, 10, 10], 100)).toBeCloseTo(1);
    expect(sq([30, 30], 100)).toBeCloseTo(1);
  });
  it('several counted options: one dominant option scores low', () => {
    expect(sq([90, 5, 5], 100)).toBeCloseTo(0.359, 2);
    expect(sq([90, 5, 5], 100)).toBeLessThan(0.5);
    const mid = sq([60, 20, 20], 100);
    expect(mid).toBeGreaterThan(0.8);
    expect(mid).toBeLessThan(0.9);
  });
});

describe('valueOf and priorityOf', () => {
  it('caps value at 0.999', () => {
    expect(valueOf(1, 1, 1)).toBe(0.999);
    expect(valueOf(0.5, 0.9, 1)).toBe(0.45);
  });
  it('adds the band base', () => {
    expect(priorityOf('high', 0.5)).toBe(2.5);
    expect(BAND_BASE.critical).toBe(3);
  });
});

describe('uncertainty', () => {
  it('emergency uses the emergency score, score 0.5 (value 1) when unknown', () => {
    const e = q('emergency', 'emergency', ['U-0']);
    expect(
      uncertainty(e, sig({}, { emergency: { status: 'ok', score: 0.9 } })),
    ).toBeCloseTo(0.36);
    expect(uncertainty(e, sig({}, { emergency: null }))).toBe(1);
    expect(uncertainty(e, sig({}, { emergency: { status: 'error' } }))).toBe(1);
  });
  it('urgency questions use the urgency score', () => {
    const s = sig({});
    s.urgency = { level: 'U-1', score: 0.9 };
    expect(
      uncertainty(q('urgency_today', 'confirm_urgency', ['U-1']), s),
    ).toBeCloseTo(0.36);
    expect(
      uncertainty(q('urgency_time', 'confirm_urgency', ['U-1']), s),
    ).toBeCloseTo(0.36);
    expect(
      uncertainty(q('urgency_today', 'confirm_urgency', ['U-1']), sig({})),
    ).toBe(1);
  });
  it('start and area use entropy, N-X excluded', () => {
    const s = sig({ 'N-HOU': 0.5, 'N-FOD': 0.5, 'N-X': 0.9 });
    expect(
      uncertainty(q('start', 'find_need', ['N-HOU', 'N-FOD', 'N-X']), s),
    ).toBeCloseTo(1);
    expect(
      uncertainty(q('area:N-HOU', 'find_need', ['N-HOU-01', 'N-HOU-02']), s),
    ).toBe(1);
    const low = sig({ 'N-HOU': 0.9, 'N-FOD': 0.01 });
    expect(
      uncertainty(q('start', 'find_need', ['N-HOU', 'N-FOD']), low),
    ).toBeLessThan(0.3);
  });
  it('narrow uses the mean yes/no, N-X excluded, 0 when empty', () => {
    const s = sig({ 'N-HOU-01': 0.5, 'N-HOU-02': 0.9, 'N-X': 0.5 });
    expect(
      uncertainty(q('narrow:1', 'narrow', ['N-HOU-01', 'N-HOU-02', 'N-X']), s),
    ).toBeCloseTo((1 + 0.36) / 2);
    expect(uncertainty(q('narrow:1', 'narrow', ['N-X']), s)).toBe(0);
  });
});
