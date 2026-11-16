import { reciprocalRankFusion } from './rank-fusion';

describe('reciprocalRankFusion', () => {
  it('returns [] for no lists and for all-empty lists', () => {
    expect(reciprocalRankFusion([], 60)).toEqual([]);
    expect(reciprocalRankFusion([[], []], 60)).toEqual([]);
  });

  it('orders by summed 1/(k+rank); a score tie goes to the better best rank, then the earlier list', () => {
    // a: 1/61 + 1/62. b: 1/62 + 1/61 (same score). c: 1/63 + 1/61 (lower).
    // a and b both have best rank 1. a's best rank is in list 0, b's in
    // list 1, so a comes first.
    expect(
      reciprocalRankFusion([['a', 'b', 'c'], ['b', 'a'], ['c']], 60),
    ).toEqual(['a', 'b', 'c']);
  });

  it('puts a doc in two lists ahead of a doc at rank 1 of only one list', () => {
    // x: rank 1 in list 0 only = 1/61 = 0.01639.
    // y: rank 2 in lists 0 and 1 = 2/62 = 0.03226.
    // z: rank 1 in list 1 only = 1/61.
    expect(
      reciprocalRankFusion(
        [
          ['x', 'y'],
          ['z', 'y'],
        ],
        60,
      ),
    ).toEqual(['y', 'x', 'z']);
  });

  it('counts a duplicate id inside one list once, at its first position', () => {
    // a = 1/61 (the repeat at rank 2 is ignored). b = rank 3 in list 0 plus
    // rank 1 in list 1 = 1/63 + 1/61, so b beats a.
    expect(reciprocalRankFusion([['a', 'a', 'b'], ['b']], 60)).toEqual([
      'b',
      'a',
    ]);
  });

  it('breaks a score tie by best rank before list order', () => {
    // k=0: v = 1/1 = 1, w = 1/1 = 1, u = 1/2 + 1/2 = 1. All tie.
    // Best ranks: v 1, w 1, u 2. v is in list 0, w in list 1, so v, w, u.
    expect(
      reciprocalRankFusion(
        [
          ['v', 'u'],
          ['w', 'u'],
        ],
        0,
      ),
    ).toEqual(['v', 'w', 'u']);
  });

  it('breaks a tie by the earlier list when the best ranks are equal', () => {
    expect(reciprocalRankFusion([['m'], ['k']], 60)).toEqual(['m', 'k']);
  });

  it('returns every id once', () => {
    const out = reciprocalRankFusion([['a', 'b'], ['b', 'c'], ['d']], 60);
    expect([...out].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('weights a list: a weight of 2 on list 1 changes the order', () => {
    // Unweighted: a = 1/61 + 1/62 = 0.03252, b = 1/62 + 1/61 (tie, a wins
    // by earlier list), c = 1/63 -> a, b, c. Lists [a,b], [b,c].
    // Unweighted: a = 1/61, b = 1/62 + 1/61, c = 1/62 -> b, a, c.
    expect(
      reciprocalRankFusion(
        [
          ['a', 'b'],
          ['b', 'c'],
        ],
        60,
      ),
    ).toEqual(['b', 'a', 'c']);
    // Weights [1, 2]: a = 1/61 = 0.016393. b = 1/62 + 2/61 = 0.048914.
    // c = 2/62 = 0.032258. Order: b, c, a.
    expect(
      reciprocalRankFusion(
        [
          ['a', 'b'],
          ['b', 'c'],
        ],
        60,
        [1, 2],
      ),
    ).toEqual(['b', 'c', 'a']);
  });

  it('treats a missing weights argument as weight 1 for every list', () => {
    expect(
      reciprocalRankFusion(
        [
          ['a', 'b'],
          ['b', 'c'],
        ],
        60,
        [1, 1],
      ),
    ).toEqual(
      reciprocalRankFusion(
        [
          ['a', 'b'],
          ['b', 'c'],
        ],
        60,
      ),
    );
  });

  it('throws when weights and lists differ in length', () => {
    expect(() => reciprocalRankFusion([['a'], ['b']], 60, [1])).toThrow(
      new Error('weights must match lists'),
    );
  });
});
