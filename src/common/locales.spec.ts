import { BadRequestException } from '@nestjs/common';
import {
  isSupportedLanguage,
  languageIndexSuffix,
  parseExactLanguage,
  SUPPORTED_LANGUAGES,
  V2_ACCEPT_LANGUAGE_MESSAGE,
} from './locales';

describe('locales', () => {
  it('lists each code once, lowercase', () => {
    expect(new Set(SUPPORTED_LANGUAGES).size).toBe(SUPPORTED_LANGUAGES.length);
    for (const c of SUPPORTED_LANGUAGES) expect(c).toBe(c.toLowerCase());
  });

  describe('languageIndexSuffix (v1, lenient)', () => {
    it.each([
      ['en', 'en'],
      ['EN', 'en'],
      ['en-US', 'en'],
      ['es-MX,es;q=0.9', 'es'],
      ['zh-Hans', 'zh_hans'],
      ['zh-Hant-TW', 'zh_hant'],
      ['xx-YY', 'xx'],
    ])('%s -> %s', (raw, suffix) => {
      expect(languageIndexSuffix(raw)).toBe(suffix);
    });

    it('names an index for every supported code', () => {
      for (const c of SUPPORTED_LANGUAGES) {
        expect(languageIndexSuffix(c)).toBe(c.replace('-', '_'));
      }
    });
  });

  describe('parseExactLanguage (v2, strict)', () => {
    it.each(['en', 'es', 'EN', ' es ', 'zh-Hans', 'zh-hant', 'yue'])(
      'accepts %p',
      (raw) => {
        expect(isSupportedLanguage(parseExactLanguage(raw))).toBe(true);
      },
    );

    it.each([
      'en-US',
      'es-MX',
      'en;q=0.9,es',
      'en,es',
      'en;q=0.9',
      '*',
      '',
      'xx',
      'zh',
      'zh-Hans-CN',
    ])('rejects %p with the exact message', (raw) => {
      const fail = () => parseExactLanguage(raw);
      expect(fail).toThrow(BadRequestException);
      expect(fail).toThrow(V2_ACCEPT_LANGUAGE_MESSAGE);
    });

    it('uses the agreed message text', () => {
      expect(V2_ACCEPT_LANGUAGE_MESSAGE).toBe(
        'accept-language must be exactly one supported code (en, es, ...); region tags like en-US and weighted lists are not accepted',
      );
    });
  });
});
