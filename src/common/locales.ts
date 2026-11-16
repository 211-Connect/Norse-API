import { BadRequestException } from '@nestjs/common';

/**
 * Languages that have a `hybrid_search_resources_{lang}` Elasticsearch index.
 * One list: `languageIndexSuffix` (index naming) and `parseExactLanguage`
 * (the /v2/search header check) both read it.
 *
 * TODO verify against prod index list (ISS-2499). This repo holds no index
 * list. The codes below are the Norse CMS locale list that
 * `PLATFORM_LOCALES` (src/metrics/usage-metrics.service.ts) reduces, with
 * `zh` split back into `zh-hans` and `zh-hant` (index names `zh_hans`,
 * `zh_hant`). That is 39 codes; the production index count is 34.
 *
 * Codes are lowercase. A script subtag joins with `-` here and with `_` in the
 * index name.
 */
export const SUPPORTED_LANGUAGES: readonly string[] = [
  'am',
  'ar',
  'de',
  'en',
  'es',
  'fa',
  'ff',
  'fi',
  'fil',
  'fj',
  'fr',
  'gu',
  'haw',
  'hi',
  'hr',
  'ht',
  'ja',
  'km',
  'ko',
  'lo',
  'mww',
  'ne',
  'om',
  'or',
  'pl',
  'prs',
  'ps',
  'pt',
  'ru',
  'rw',
  'sm',
  'so',
  'sw',
  'tl',
  'uk',
  'vi',
  'yue',
  'zh-hans',
  'zh-hant',
];

const SUPPORTED_SET: ReadonlySet<string> = new Set(SUPPORTED_LANGUAGES);

export const isSupportedLanguage = (code: string): boolean =>
  SUPPORTED_SET.has(code);

/**
 * Index suffix for an `accept-language` value, lenient (v1): first entry of a
 * list, region dropped, a 4-letter script kept (`zh-Hans` becomes `zh_hans`).
 * It never checks the list; an unknown code names an index that does not exist.
 */
export function languageIndexSuffix(lang: string): string {
  const preferred = lang.split(',')[0].trim().toLowerCase();
  const parts = preferred.split('-');
  const base = parts[0];

  if (parts.length > 1 && parts[1].length === 4) {
    return `${base}_${parts[1]}`;
  }

  return base;
}

export const V2_ACCEPT_LANGUAGE_MESSAGE =
  'accept-language must be exactly one supported code (en, es, ...); ' +
  'region tags like en-US and weighted lists are not accepted';

/**
 * Strict (v2): the raw header must be exactly one supported code, compared
 * case-insensitively. Region tags, weighted lists, `*` and codes without an
 * index throw 400. Returns the lowercase code.
 */
export function parseExactLanguage(raw: string): string {
  const code = raw.trim().toLowerCase();
  if (!isSupportedLanguage(code)) {
    throw new BadRequestException(V2_ACCEPT_LANGUAGE_MESSAGE);
  }
  return code;
}
