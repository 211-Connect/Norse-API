import { holdsAllWords, queryTokens, withinOneEdit } from './word-match';

describe('holdsAllWords', () => {
  it('a word, or the start of one with 4+ letters', () => {
    expect(holdsAllWords(['seat'], 'Seattle Org')).toBe(true);
    expect(holdsAllWords(['sea'], 'Seattle Org')).toBe(false);
    expect(holdsAllWords(['food', 'bank'], 'Ballard Food Bank')).toBe(true);
    expect(holdsAllWords(['food', 'bank'], 'Ballard Food Pantry')).toBe(false);
  });
  it('no query token: false', () => {
    expect(holdsAllWords([], 'YMCA')).toBe(false);
    expect(holdsAllWords(['a'], 'A')).toBe(false);
  });
});

describe('queryTokens, withinOneEdit', () => {
  it('queryTokens: request words and ZIP codes are out', () => {
    expect(queryTokens(['i', 'need', 'food', '98101'])).toEqual(['food']);
  });
  it('withinOneEdit: insert, delete, substitute, swap', () => {
    expect(withinOneEdit('foood', 'food')).toBe(true);
    expect(withinOneEdit('fod', 'food')).toBe(true);
    expect(withinOneEdit('fuod', 'food')).toBe(true);
    expect(withinOneEdit('fodo', 'food')).toBe(true);
    expect(withinOneEdit('fxxd', 'food')).toBe(false);
  });
});
