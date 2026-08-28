// Response-time translation projection for GET /organization/:id. Storage is
// untouched: the stored org keeps every locale; these helpers narrow the
// response to the requested locale at every nesting level.

type TranslationRow = {
  LOCALE?: string;
  IS_CANONICAL?: boolean;
  [key: string]: unknown;
};

const TRANSLATIONS_KEY = 'translations';

const isTranslationRowArray = (value: unknown): value is TranslationRow[] =>
  Array.isArray(value) &&
  value.every((row) => row !== null && typeof row === 'object');

// Mirrors the provider-feedback consumer's selectTranslation: preferred locale,
// then English, then the canonical row — so a missing locale never renders blank.
// Returns a filtered ARRAY (never a scalar); the consumer does its own selection.
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

// Walks the org graph and, wherever a `translations`/`TRANSLATIONS` array of
// rows appears (org, services[], SCHEDULES[], LANGUAGES[], SERVICE_AREAS[],
// REQUIRED_DOCUMENTS[], locations[], phones[], contacts[], ...), keeps only the
// rows for the resolved locale. Mutates the passed node in place and returns it.
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
