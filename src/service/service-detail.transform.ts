import type { PipelineStage } from 'mongoose';

/**
 * Narrowing `TRANSLATIONS` in the DATABASE, not after the fact.
 *
 * `organization-detail.transform.ts` filters translations in JavaScript once
 * the document has already been fetched. That is correct, and it does not
 * reduce what crosses the wire — which is the whole problem here.
 *
 * Measured on `search_engine.services`, 2026-09-21: every `nest_i18n` field
 * carries NINE locales (en, vi, es, yue, ar, zh-Hans, ru, ko, am), and
 * `TRANSLATIONS` is 84-93% of each entry's bytes — roughly half of the
 * collection's 1.62 GB. In `NORSE_STAGING`, a single MD211_V2 service spans
 * 666 locations, so once that tenant loads, a document carrying nine locales
 * for each of those locations' schedules, languages and accessibility entries
 * is a multi-megabyte fetch for a consumer that renders one language.
 *
 * So the pipeline drops the locales nobody asked for before the driver sees
 * them.
 *
 * ## Why a SUPERSET, and not the final pick
 *
 * `selectLocaleRows` resolves requested -> English -> canonical. Expressing
 * that whole chain per array inside an aggregation would be a large and
 * fragile expression. Instead the pipeline keeps the three kinds of row that
 * chain can ever choose from, and the existing JavaScript transform makes the
 * final selection from that small set.
 *
 * The observable result is therefore IDENTICAL to the organization endpoint's,
 * by construction: the JS filter still sees every row it could have picked.
 * What changes is that six to eight locales per entry never leave the database.
 */
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

/** Rows the JS selection could still choose: the asked-for locale, English, or canonical. */
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

/** An array of entries, each with its `TRANSLATIONS` narrowed. */
const narrowArray = (arrayExpr: unknown, locale: string) => ({
  $map: {
    input: { $ifNull: [arrayExpr, []] },
    as: 'e',
    in: {
      $mergeObjects: [
        '$$e',
        { TRANSLATIONS: keepRows('$$e.TRANSLATIONS', locale) },
      ],
    },
  },
});

/**
 * The `$addFields` stage that narrows every translation-bearing path.
 *
 * `locations` needs two levels: each location's own nested arrays carry
 * translations, and there may be hundreds of locations on one service.
 *
 * Paths NOT listed here are still handled — the JavaScript transform runs
 * afterwards and walks the whole document. This stage is an optimisation over
 * the paths that carry the bytes, not a replacement for it, so a
 * translation-bearing path added upstream degrades to the old behaviour rather
 * than leaking other locales to the client.
 */
export const narrowTranslationsStage = (locale: string): PipelineStage => ({
  $addFields: {
    ...Object.fromEntries(
      TRANSLATION_BEARING_PATHS.map((p) => [p, narrowArray(`$${p}`, locale)]),
    ),
    // An orphan service has SQL NULL here, and `$mergeObjects` over null would
    // manufacture an object — the exact `{}`-is-truthy hazard the dbt model
    // guards against with its own CASE.
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
