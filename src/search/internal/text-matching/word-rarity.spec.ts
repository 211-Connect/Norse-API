import {
  contentWords,
  idf,
  adjacentJoins,
  MAX_RARITY_WORDS,
  queryWords,
  splitCandidates,
} from './word-rarity';

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

  describe('adjacentJoins', () => {
    it('joins every span of 2 or 3 adjacent words, never single words', () => {
      const joins = adjacentJoins('food bank near me').map((j) => j.join);
      expect(joins).toEqual(
        expect.arrayContaining([
          'foodbank',
          'foodbanknear',
          'banknear',
          'nearme',
        ]),
      );
      expect(joins).not.toContain('food');
      expect(joins).not.toContain('bank');
    });

    it('keeps the words of each join', () => {
      expect(adjacentJoins('my free taxes')).toContainEqual({
        join: 'myfreetaxes',
        words: ['my', 'free', 'taxes'],
      });
    });

    it('drops joins shorter than 5 characters', () => {
      const joins = adjacentJoins('to be').map((j) => j.join);
      expect(joins).toEqual([]);
    });

    it('caps at 20 entries', () => {
      const q = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
      expect(adjacentJoins(q)).toHaveLength(20);
    });
  });

  describe('splitCandidates', () => {
    it('splits a word at every point leaving 3+ characters each side', () => {
      expect(splitCandidates('foodbank')).toEqual([
        'foo dbank',
        'food bank',
        'foodb ank',
      ]);
    });

    it('returns nothing for short words and words with digits', () => {
      expect(splitCandidates('rent')).toEqual([]);
      expect(splitCandidates('abc123def')).toEqual([]);
    });
  });
});
