/**
 * Per-language switches for search features (ISS-2693). One opinionated place.
 *
 * A feature listed in `ENGLISH_ONLY_FEATURES` does nothing for a query whose
 * language is not `en`: no boost, no zero, the input passes through. Reason:
 * the feature reads English words (request patterns, group names).
 *
 * To add a language later, give the feature a rule for it and move it out of
 * this list. To switch a feature off for all languages, remove its call site.
 */
export const ENGLISH_ONLY_FEATURES = ['populationWeight'] as const;

export type EnglishOnlyFeature = (typeof ENGLISH_ONLY_FEATURES)[number];

/** Base language of an accept-language value: first entry, region and script dropped. Empty means `en`. */
export function baseLanguage(lang: string | undefined): string {
  const first = (lang ?? '').split(',')[0].split(';')[0].trim().toLowerCase();
  return first ? first.split(/[-_]/)[0] : 'en';
}

/** True when the feature runs for this language. */
export function isFeatureOnForLanguage(
  feature: EnglishOnlyFeature,
  lang: string | undefined,
): boolean {
  return (
    !(ENGLISH_ONLY_FEATURES as readonly string[]).includes(feature) ||
    baseLanguage(lang) === 'en'
  );
}
