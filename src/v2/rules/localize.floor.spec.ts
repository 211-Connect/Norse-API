import { floorOnlyEmergency } from './localize';
import { RulesSignals } from './types';

// Limited locales: the danger question needs a keyword-floor hit (Lucas 2026-11-20).
// An unknown floor is not "no hit": the model score stays (never read unknown as zero).
describe('floorOnlyEmergency', () => {
  const withEmergency = (emergency: unknown) =>
    ({ emergency }) as unknown as RulesSignals;

  it('floor checked, no hit: the model-only score is dropped', () => {
    const out = floorOnlyEmergency(
      withEmergency({ status: 'ok', score: 0.97, floor_hit: false }),
    );
    expect(out.emergency).toEqual({ status: 'ok', score: 0 });
  });

  it('floor hit: unchanged', () => {
    const s = withEmergency({ status: 'ok', score: 0.97, floor_hit: true });
    expect(floorOnlyEmergency(s)).toBe(s);
  });

  it.each([[null], [undefined]])(
    'floor unknown (%p): the model score stays',
    (floor_hit) => {
      const s = withEmergency({ status: 'ok', score: 0.97, floor_hit });
      expect(floorOnlyEmergency(s)).toBe(s);
    },
  );

  it('an error stays an error', () => {
    const s = withEmergency({ status: 'error' });
    expect(floorOnlyEmergency(s)).toBe(s);
  });
});
