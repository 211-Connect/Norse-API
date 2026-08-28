// Response-time locale narrowing for GET /organization/:id; storage keeps every
// locale.

type TranslationRow = {
  LOCALE?: string;
  IS_CANONICAL?: boolean;
  [key: string]: unknown;
};

const TRANSLATIONS_KEY = 'translations';

const isTranslationRowArray = (value: unknown): value is TranslationRow[] =>
  Array.isArray(value) &&
  value.every((row) => row !== null && typeof row === 'object');

// Preferred locale, then English, then canonical, mirroring the
// provider-feedback consumer. Returns an ARRAY (never a scalar); the consumer
// makes the final selection.
export const selectLocaleRows = (
  rows: TranslationRow[],
  locale: string,
): TranslationRow[] => {
  const forLocale = (target: string) =>
    rows.filter((row) => row?.LOCALE === target);

  const preferred = forLocale(locale);
  if (preferred.length) return preferred;

  const english = forLocale('en');
  if (english.length) return english;

  return rows.filter((row) => row?.IS_CANONICAL === true);
};

// Narrows every `translations`/`TRANSLATIONS` array at any nesting level to the
// resolved locale. Mutates the passed node in place and returns it.
export const filterTranslationsByLocale = <T>(node: T, locale: string): T => {
  if (Array.isArray(node)) {
    for (const item of node) filterTranslationsByLocale(item, locale);
    return node;
  }

  if (node !== null && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const value = record[key];
      if (
        key.toLowerCase() === TRANSLATIONS_KEY &&
        isTranslationRowArray(value)
      ) {
        record[key] = selectLocaleRows(value, locale);
      } else {
        filterTranslationsByLocale(value, locale);
      }
    }
  }

  return node;
};
