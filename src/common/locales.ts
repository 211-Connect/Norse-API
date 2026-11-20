import { BadRequestException } from '@nestjs/common';

/**
 * Languages that have a `hybrid_search_resources_{lang}` Elasticsearch index.
 * One list: `languageIndexSuffix` (index naming) and `parseExactLanguage`
 * (the /v2/search header check) both read it.
 *
 * The 34 codes below match the production index list. They come from the Norse
 * CMS locale list that `PLATFORM_LOCALES` (src/metrics/usage-metrics.service.ts)
 * reduces, with `zh` split back into `zh-hans` and `zh-hant` (index names
 * `zh_hans`, `zh_hant`).
 *
 * `fi`, `km`, `lo`, `mww` and `or` are CMS locales without a prod index. They
 * return to this list when their `hybrid_search_resources_{lang}` index exists.
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
  'fil',
  'fj',
  'fr',
  'gu',
  'haw',
  'hi',
  'hr',
  'ht',
  'ja',
  'ko',
  'ne',
  'om',
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
 * A value that is not a code at all (`*`, `_all`, empty) is a 400, never an
 * index pattern.
 */
export function languageIndexSuffix(lang: string): string {
  const preferred = lang.split(',')[0].trim().toLowerCase();
  const parts = preferred.split('-');
  const base = parts[0];

  const suffix =
    parts.length > 1 && parts[1].length === 4 ? `${base}_${parts[1]}` : base;

  // The suffix becomes part of an index name, where `*`, `?`, `,` and `_all`
  // are patterns: `accept-language: *` would search every language index.
  // Fail loudly rather than name a pattern (David, PR #279 review).
  if (!INDEX_SUFFIX.test(suffix)) {
    throw new BadRequestException(V1_ACCEPT_LANGUAGE_MESSAGE);
  }
  return suffix;
}

/** A language code as an index suffix: `en`, `haw`, `zh_hans`. */
const INDEX_SUFFIX = /^[a-z]{2,3}(_[a-z]{4})?$/;

export const V1_ACCEPT_LANGUAGE_MESSAGE =
  'accept-language must start with a language code such as en, es or zh-Hans';

export const V2_ACCEPT_LANGUAGE_MESSAGE =
  `locale must be exactly one supported code (${SUPPORTED_LANGUAGES.join(', ')}); ` +
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
