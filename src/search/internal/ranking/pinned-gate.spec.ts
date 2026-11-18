import {
  PINNED_GATE_FRACTION,
  pinnedGateUsesQuery,
  selectGatedPinnedIds,
} from './pinned-gate';

describe('selectGatedPinnedIds', () => {
  it('passes a score equal to fraction x top (inclusive)', () => {
    expect(selectGatedPinnedIds([{ id: 'a', score: 8 }], 10, 0.8)).toEqual([
      'a',
    ]);
  });

  it('drops a score below the threshold', () => {
    expect(selectGatedPinnedIds([{ id: 'a', score: 7.9 }], 10, 0.8)).toEqual(
      [],
    );
  });

  it('returns [] when the top other score is 0 or not finite', () => {
    const hits = [{ id: 'a', score: 5 }];
    expect(selectGatedPinnedIds(hits, 0)).toEqual([]);
    expect(selectGatedPinnedIds(hits, NaN)).toEqual([]);
    expect(selectGatedPinnedIds(hits, Infinity)).toEqual([]);
    expect(selectGatedPinnedIds(hits, -1)).toEqual([]);
  });

  it('drops non-positive and non-finite scores', () => {
    expect(
      selectGatedPinnedIds(
        [
          { id: 'a', score: 0 },
          { id: 'b', score: -3 },
          { id: 'c', score: NaN },
          { id: 'd', score: 5 },
        ],
        1,
        0,
      ),
    ).toEqual(['d']);
  });

  it('orders by score descending, then id ascending, without duplicates', () => {
    expect(
      selectGatedPinnedIds(
        [
          { id: 'b', score: 9 },
          { id: 'a', score: 9 },
          { id: 'c', score: 10 },
          { id: 'a', score: 9 },
        ],
        10,
      ),
    ).toEqual(['c', 'a', 'b']);
  });

  it('uses the default fraction', () => {
    expect(PINNED_GATE_FRACTION).toBe(0.8);
    expect(selectGatedPinnedIds([{ id: 'a', score: 8 }], 10)).toEqual(['a']);
  });

  it('honours a custom fraction', () => {
    const hits = [{ id: 'a', score: 5 }];
    expect(selectGatedPinnedIds(hits, 10, 0.5)).toEqual(['a']);
    expect(selectGatedPinnedIds(hits, 10, 0.6)).toEqual([]);
  });
});

describe('pinnedGateUsesQuery', () => {
  it('is true only for v2, ranked, non-blank query', () => {
    expect(
      pinnedGateUsesQuery({ v2: true, rank: true, queryStr: 'food' }),
    ).toBe(true);
    expect(
      pinnedGateUsesQuery({ v2: false, rank: true, queryStr: 'food' }),
    ).toBe(false);
    expect(pinnedGateUsesQuery({ v2: true, rank: true, queryStr: '' })).toBe(
      false,
    );
    expect(pinnedGateUsesQuery({ v2: true, rank: true, queryStr: '  ' })).toBe(
      false,
    );
    expect(
      pinnedGateUsesQuery({ v2: true, rank: false, queryStr: 'food' }),
    ).toBe(false);
  });
});
