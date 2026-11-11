import { contentWords, idf, MAX_RARITY_WORDS, queryWords } from './word-rarity';

describe('word-rarity', () => {
  describe('queryWords', () => {
    it('lowercases, strips apostrophes and punctuation', () => {
      expect(queryWords("My boyfriend's  HITS me!")).toEqual([
        'my',
        'boyfriends',
        'hits',
        'me',
      ]);
    });

    it('folds accents', () => {
      expect(queryWords('Café')).toEqual(['cafe']);
    });

    it('drops one-letter tokens', () => {
      expect(queryWords('a b food')).toEqual(['food']);
    });

    it('dedupes keeping first-seen order', () => {
      expect(queryWords('food shelf food')).toEqual(['food', 'shelf']);
    });
  });

  describe('contentWords', () => {
    it('drops English function words', () => {
      expect(contentWords('my boyfriend hits me', 'en')).toEqual([
        'boyfriend',
        'hits',
      ]);
    });

    it('keeps every word for other languages', () => {
      expect(contentWords('my boyfriend', 'es')).toEqual(['my', 'boyfriend']);
    });

    it('caps the word count', () => {
      const q = Array.from({ length: 20 }, (_, i) => `word${i}`).join(' ');
      expect(contentWords(q, 'en')).toHaveLength(MAX_RARITY_WORDS);
      expect(MAX_RARITY_WORDS).toBe(12);
    });
  });

  describe('idf', () => {
    it('is larger for rarer words and stays positive', () => {
      expect(idf(29181, 0)).toBeGreaterThan(idf(29181, 2));
      expect(idf(29181, 2)).toBeGreaterThan(idf(29181, 3000));
      expect(idf(29181, 3000)).toBeGreaterThan(0);
    });
  });
});
