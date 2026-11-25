import {
  ENGLISH_ONLY_FEATURES,
  baseLanguage,
  isFeatureOnForLanguage,
} from './language-switches';

describe('language switches', () => {
  it('lists the population weight as English only', () => {
    expect(ENGLISH_ONLY_FEATURES).toContain('populationWeight');
  });
  it.each([
    ['en', 'en'],
    ['EN-us', 'en'],
    ['en-US,en;q=0.9', 'en'],
    ['es', 'es'],
    ['zh-Hans', 'zh'],
    ['', 'en'],
    [undefined, 'en'],
  ])('baseLanguage(%s) is %s', (input, expected) => {
    expect(baseLanguage(input)).toBe(expected);
  });
  it('runs an English-only feature for en and skips it for es', () => {
    expect(isFeatureOnForLanguage('populationWeight', 'en')).toBe(true);
    expect(isFeatureOnForLanguage('populationWeight', 'es')).toBe(false);
  });
});
