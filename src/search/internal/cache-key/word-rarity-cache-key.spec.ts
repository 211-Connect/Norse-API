import { wordRarityCacheKey } from './word-rarity-cache-key';

describe('wordRarityCacheKey', () => {
  it('is stable for the same word, tenant and language', () => {
    expect(wordRarityCacheKey('t1', 'en', 'shelter')).toBe(
      wordRarityCacheKey('t1', 'en', 'shelter'),
    );
  });

  it('carries tenant and language in the clear', () => {
    expect(wordRarityCacheKey('t1', 'en', 'shelter')).toMatch(
      /^search:rarity3:t1:en:/,
    );
  });

  it('differs by word, tenant and language', () => {
    const base = wordRarityCacheKey('t1', 'en', 'shelter');
    expect(wordRarityCacheKey('t1', 'en', 'housing')).not.toBe(base);
    expect(wordRarityCacheKey('t2', 'en', 'shelter')).not.toBe(base);
    expect(wordRarityCacheKey('t1', 'es', 'shelter')).not.toBe(base);
  });

  it('stays short for a very long word', () => {
    expect(
      wordRarityCacheKey('t1', 'en', 'a'.repeat(4000)).length,
    ).toBeLessThan(80);
  });
});
