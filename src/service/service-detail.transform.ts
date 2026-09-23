import type { PipelineStage } from 'mongoose';

// Narrowed in the database rather than after the fetch, unlike
// `organization-detail.transform.ts`: translations are 84-93% of each nested
// entry's bytes across nine locales, and filtering post-fetch does not reduce
// what crosses the wire.
//
// Keeps a SUPERSET of what `selectLocaleRows` can pick — requested, English,
// canonical — and lets that function make the final choice, so the response is
// identical to the organization endpoint's. Paths not listed below are still
// filtered by it afterwards.

const TRANSLATION_BEARING_PATHS = [
  'phones',
  'contacts',
  'schedules',
  'languages',
  'serviceAreas',
  'costOptions',
  'funding',
  'requiredDocuments',
  'attributeTaxonomies',
] as const;

const LOCATION_NESTED_PATHS = [
  'PHONES',
  'CONTACTS',
  'LANGUAGES',
  'ACCESSIBILITY',
  'SCHEDULES',
] as const;

const keepRows = (translations: unknown, locale: string) => ({
  $filter: {
    input: { $ifNull: [translations, []] },
    as: 't',
    cond: {
      $or: [
        { $eq: ['$$t.LOCALE', locale] },
        { $eq: ['$$t.LOCALE', 'en'] },
        { $eq: ['$$t.IS_CANONICAL', true] },
      ],
    },
  },
});

const narrowArray = (arrayExpr: unknown, locale: string) => ({
  $map: {
    input: { $ifNull: [arrayExpr, []] },
    as: 'e',
    in: {
      $mergeObjects: [
        '$$e',
        { TRANSLATIONS: keepRows('$$e.TRANSLATIONS', locale) },
        // Added conditionally so entries without it do not gain an empty array.
        {
          $cond: [
            { $eq: [{ $type: '$$e.TAXONOMY_NAME_TRANSLATIONS' }, 'missing'] },
            {},
            {
              TAXONOMY_NAME_TRANSLATIONS: keepRows(
                '$$e.TAXONOMY_NAME_TRANSLATIONS',
                locale,
              ),
            },
          ],
        },
      ],
    },
  },
});

export const narrowTranslationsStage = (locale: string): PipelineStage => ({
  $addFields: {
    ...Object.fromEntries(
      TRANSLATION_BEARING_PATHS.map((p) => [p, narrowArray(`$${p}`, locale)]),
    ),
    // `$mergeObjects` over a null organization would return an object, making
    // an orphan service indistinguishable from a real one.
    organization: {
      $cond: [
        { $in: [{ $type: '$organization' }, ['missing', 'null']] },
        null,
        {
          $mergeObjects: [
            '$organization',
            { TRANSLATIONS: keepRows('$organization.TRANSLATIONS', locale) },
          ],
        },
      ],
    },
    locations: {
      $map: {
        input: { $ifNull: ['$locations', []] },
        as: 'loc',
        in: {
          $mergeObjects: [
            '$$loc',
            Object.fromEntries(
              LOCATION_NESTED_PATHS.map((p) => [
                p,
                narrowArray(`$$loc.${p}`, locale),
              ]),
            ),
          ],
        },
      },
    },
  },
});
