import {
  FUNCTION_WORDS,
  SNOWBALL_ENGLISH_STOP_WORDS,
  functionWordsFor,
} from './function-words';
import { queryWords } from './query-words';

describe('function words', () => {
  it('the Snowball English list is kept whole (174 entries)', () => {
    expect(SNOWBALL_ENGLISH_STOP_WORDS).toHaveLength(174);
    expect(SNOWBALL_ENGLISH_STOP_WORDS).toContain("couldn't");
  });

  it('holds every Snowball word, normalised as queryWords does, longer than one character', () => {
    const en = FUNCTION_WORDS.en;
    const expected = SNOWBALL_ENGLISH_STOP_WORDS.flatMap((w) => queryWords(w));
    expect(expected.length).toBeGreaterThan(150);
    for (const w of expected) {
      expect(w.length).toBeGreaterThan(1);
      expect(en.has(w)).toBe(true);
    }
  });

  it.each([
    'couldnt',
    'wouldnt',
    'havent',
    'werent',
    'youve',
    'youll',
    'would',
    'could',
    'cannot',
    'thats',
  ])('includes %s, which the hand-typed list missed', (w) => {
    expect(FUNCTION_WORDS.en.has(w)).toBe(true);
  });

  it('keeps the words of the earlier hand-typed list that queries rely on', () => {
    for (const w of ['my', 'me', 'im', 'dont', 'cant', 'wont', 'can', 'will']) {
      expect(FUNCTION_WORDS.en.has(w)).toBe(true);
    }
  });

  it('holds no one-letter entry, because queryWords drops one-letter tokens', () => {
    for (const w of FUNCTION_WORDS.en) expect(w.length).toBeGreaterThan(1);
  });

  it('does not hold content words', () => {
    for (const w of ['boyfriend', 'shelter', 'food', 'hits', 'rent']) {
      expect(FUNCTION_WORDS.en.has(w)).toBe(false);
    }
  });

  describe('functionWordsFor', () => {
    it('returns the English set for en and for region forms of en', () => {
      expect(functionWordsFor('en')).toBe(FUNCTION_WORDS.en);
      expect(functionWordsFor('en-US')).toBe(FUNCTION_WORDS.en);
      expect(functionWordsFor('en-GB')).toBe(FUNCTION_WORDS.en);
      expect(functionWordsFor('EN-us')).toBe(FUNCTION_WORDS.en);
      expect(functionWordsFor('en_US')).toBe(FUNCTION_WORDS.en);
    });

    it('returns undefined for other languages, and does not match by prefix', () => {
      expect(functionWordsFor('es')).toBeUndefined();
      expect(functionWordsFor('zh-Hans')).toBeUndefined();
      expect(functionWordsFor('eng')).toBeUndefined();
      expect(functionWordsFor('')).toBeUndefined();
    });
  });
});
