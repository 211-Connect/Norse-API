import {
  areaRuleTarget,
  emergencyBand,
  needStates,
  urgencyState,
} from './bands';
import { req, sig } from '../../common/testing/v2-rules-helpers';

describe('emergencyBand', () => {
  const ok = (score: number, o = {}) => ({
    status: 'ok' as const,
    score,
    ...o,
  });
  it('null -> none, error -> unknown, missing score -> unknown', () => {
    expect(emergencyBand(null)).toBe('none');
    expect(emergencyBand({ status: 'error' })).toBe('unknown');
    expect(emergencyBand({ status: 'ok' })).toBe('unknown');
  });
  it('non-finite score -> unknown', () => {
    expect(emergencyBand(ok(NaN))).toBe('unknown');
    expect(emergencyBand(ok(Infinity))).toBe('unknown');
  });
  it('plain cutoffs', () => {
    expect(emergencyBand(ok(0.6619))).toBe('soft');
    expect(emergencyBand(ok(0.662))).toBe('popup');
    expect(emergencyBand(ok(0.2209))).toBe('none');
    expect(emergencyBand(ok(0.221))).toBe('soft');
  });
  it('floorHit', () => {
    expect(emergencyBand(ok(0.1, { floorHit: true }))).toBe('soft');
    expect(emergencyBand(ok(0.6619, { floorHit: true }))).toBe('soft');
    expect(emergencyBand(ok(0.662, { floorHit: true }))).toBe('popup');
  });
  it('calmContext never popup', () => {
    expect(emergencyBand(ok(0.9, { calmContext: true }))).toBe('soft');
    expect(emergencyBand(ok(0.2209, { calmContext: true }))).toBe('none');
    expect(emergencyBand(ok(0.221, { calmContext: true }))).toBe('soft');
  });
  it('dvShelter', () => {
    expect(emergencyBand(ok(0.1, { dvShelter: true }))).toBe('soft');
    expect(emergencyBand(ok(0.7, { dvShelter: true }))).toBe('popup');
  });
});

describe('urgencyState', () => {
  const withU = (score: number) => ({
    status: 'ok' as const,
    scores: {},
    urgency: { level: 'U-2' as const, score },
  });
  it('non-finite urgency score -> drop', () => {
    expect(urgencyState(req(), withU(NaN))).toEqual({
      value: 'U-X',
      source: 'default',
      state: 'drop',
    });
  });
  it('cutoffs', () => {
    expect(urgencyState(req(), withU(0.7999))).toEqual({
      value: 'U-X',
      source: 'default',
      state: 'drop',
    });
    expect(urgencyState(req(), withU(0.8))).toEqual({
      value: 'U-X',
      source: 'default',
      state: 'ask',
    });
    expect(urgencyState(req(), withU(0.9299)).state).toBe('ask');
    expect(urgencyState(req(), withU(0.93))).toEqual({
      value: 'U-2',
      source: 'inferred',
      state: 'use',
    });
  });
  it('caller wins', () => {
    expect(urgencyState(req({ urgency: 'U-3' }), withU(0.99))).toEqual({
      value: 'U-3',
      source: 'caller',
      state: 'use',
    });
  });
  it('error -> default drop', () => {
    expect(urgencyState(req(), { status: 'error' })).toEqual({
      value: 'U-X',
      source: 'default',
      state: 'drop',
    });
  });
});

describe('needStates', () => {
  const find = (r: ReturnType<typeof needStates>, c: string) =>
    r.needs.find((n) => n.code === c);
  it('0.97 use, 0.9699 ask, 0.12 ask, 0.1199 dropped', () => {
    const r = needStates(
      req(),
      sig({
        'N-FOD-01': 0.97,
        'N-FOD-02': 0.9699,
        'N-FOD-03': 0.12,
        'N-FOD-04': 0.1199,
      }),
    );
    expect(find(r, 'N-FOD-01').state).toBe('use');
    expect(find(r, 'N-FOD-02').state).toBe('ask');
    expect(find(r, 'N-FOD-03').state).toBe('ask');
    expect(find(r, 'N-FOD-04')).toBeUndefined();
  });
  it('Tier 1 at 0.5 is not ask', () => {
    expect(needStates(req(), sig({ 'N-FOD': 0.5 })).needs).toEqual([]);
  });
  it('passed code skipped', () => {
    const r = needStates(
      req({ passedNeeds: ['N-FOD-01'] }),
      sig({ 'N-FOD-01': 0.99 }),
    );
    expect(r.needs).toEqual([]);
  });
  it('confirmed + inferred same code -> one caller state', () => {
    const r = needStates(
      req({ needs: ['N-FOD-01'] }),
      sig({ 'N-FOD-01': 0.99 }),
    );
    expect(r.needs).toEqual([
      { code: 'N-FOD-01', state: 'use', source: 'caller' },
    ]);
  });
  it('confirmed wins over passed', () => {
    const r = needStates(
      req({ needs: ['N-FOD-01'], passedNeeds: ['N-FOD-01'] }),
      sig(),
    );
    expect(r.needs[0].source).toBe('caller');
  });
  it('boostNeeds drops N-HOU when N-HOU-02 present', () => {
    const r = needStates(
      req(),
      sig({ 'N-HOU': 0.99, 'N-HOU-02': 0.98, 'N-FOD': 0.98 }),
    );
    expect(r.boostNeeds).toEqual(['N-FOD', 'N-HOU-02']);
  });
  it('confirmed N-X kept, not in boost', () => {
    const r = needStates(req({ needs: ['N-X'] }), sig());
    expect(r.needs).toEqual([{ code: 'N-X', state: 'use', source: 'caller' }]);
    expect(r.boostNeeds).toEqual([]);
    expect(r.nx).toBe(true);
  });
  it('nx rule both ways', () => {
    expect(needStates(req(), sig({ 'N-X': 0.07 })).nx).toBe(true);
    expect(needStates(req(), sig({ 'N-X': 0.0699 })).nx).toBe(false);
    expect(needStates(req(), sig({ 'N-X': 0.5, 'N-FOD-01': 0.99 })).nx).toBe(
      false,
    );
  });
  it('error status gives only caller needs', () => {
    const r = needStates(req({ needs: ['N-HOU'] }), {
      needs: { status: 'error' },
      emergency: null,
    });
    expect(r.needs.length).toBe(1);
  });
});

describe('areaRuleTarget', () => {
  const t = (scores: Record<string, number>, r = req()) => {
    const s = sig(scores);
    return areaRuleTarget(r, s, needStates(r, s));
  };
  it('fires at T1 0.9 and max T2 0.4999', () => {
    expect(t({ 'N-MHS': 0.9, 'N-MHS-01': 0.4999 })).toBe('N-MHS');
  });
  it('not at T2 0.5', () => {
    expect(t({ 'N-MHS': 0.9, 'N-MHS-01': 0.5 })).toBeNull();
  });
  it('not at T1 0.8999', () => {
    expect(t({ 'N-MHS': 0.8999, 'N-MHS-01': 0.1 })).toBeNull();
  });
  it('not when area has confirmed Tier 2', () => {
    expect(t({ 'N-MHS': 0.95 }, req({ needs: ['N-MHS-01'] }))).toBeNull();
  });
  it('not when status error', () => {
    const r = req();
    const s = { needs: { status: 'error' as const }, emergency: null };
    expect(areaRuleTarget(r, s, needStates(r, s))).toBeNull();
  });
});
