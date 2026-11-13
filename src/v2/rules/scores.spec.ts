import { finiteScore, scoreOf } from './scores';

describe('finiteScore', () => {
  it.each([0, 0.5, 1, -0.2])('keeps the finite number %p', (x) => {
    expect(finiteScore(x)).toBe(x);
  });
  it.each([NaN, Infinity, -Infinity, undefined, null, '0.9'])(
    'reads %p as no score',
    (x) => {
      expect(finiteScore(x)).toBeUndefined();
    },
  );
});

describe('scoreOf', () => {
  const scores = { a: 0.7, b: NaN, c: Infinity };
  it('returns the score of a code', () => {
    expect(scoreOf(scores, 'a')).toBe(0.7);
  });
  it('reads a missing or non-finite score as 0', () => {
    expect(scoreOf(scores, 'b')).toBe(0);
    expect(scoreOf(scores, 'c')).toBe(0);
    expect(scoreOf(scores, 'missing')).toBe(0);
    expect(scoreOf(undefined, 'a')).toBe(0);
  });
});
