import {
  FieldValue,
  QueryDslQueryContainer,
  Sort,
} from '@elastic/elasticsearch/lib/api/types';
import { REGIONS_INDEX } from '../../region/internal';
import { VirtualMode } from './dto';

/**
 * The ES `services` index (ADR 0023). Filters mirror ServiceNet's Mongo
 * `buildQuery` (`sharing-mongo/src/record-source.ts`) clause for clause so the
 * two return the same records; text and its ordering deliberately differ.
 */

export const SERVICES_INDEX = 'services';

export const SERVICE_TEXT_FIELDS = [
  'name^3',
  'alternateName',
  'description',
  'organizationName',
] as const;

export const SERVICE_LIST_SOURCE_FIELDS = [
  'serviceId',
  'tenant_id',
  'resourceWriterId',
  'isCanonicalPublication',
  'status',
  'taxonomyPath',
  'taxonomyCodes',
  'locationTypes',
  'name',
  'alternateName',
  'description',
  'organizationName',
  'city',
  'assuredDate',
];

/** `name.substring`: the `wildcard`-typed subfield Dagster #601 adds for contains matching. */
export const SERVICE_NAME_SUBSTRING_FIELD = 'name.substring';

export type SortMode = 'name' | 'score';

export const sortModeFor = (text: string | undefined): SortMode =>
  (text?.trim() ?? '') === '' ? 'name' : 'score';

/**
 * No text: case-sensitive `name.raw`, missing first, is Mongo's `{name: 1}`.
 * Text: `_score`, a deliberate change from Mongo. `serviceId` breaks ties so a
 * page boundary inside a tie cannot skip or repeat records.
 */
export function serviceListSort(mode: SortMode): Sort {
  return mode === 'score'
    ? [{ _score: { order: 'desc' } }, { serviceId: { order: 'asc' } }]
    : [
        { 'name.raw': { order: 'asc', missing: '_first' } },
        { serviceId: { order: 'asc' } },
      ];
}

export interface GeoPoint {
  lat: number;
  lng: number;
  radiusMiles: number;
}

export interface ServiceFilterInput {
  resourceWriterIds: readonly string[];
  taxonomyCodes?: readonly string[];
  statuses?: readonly string[];
  regionIds?: readonly string[];
  points?: readonly GeoPoint[];
  virtual?: VirtualMode;
}

/** The field Dagster #601 loads with the union of a service's Service Areas. */
export const SERVICE_AREA_FIELD = 'service_area';

/**
 * A Virtual Service that publishes no Service Area serves every Region
 * (ADR 0025). A physical service with no Service Area serves none: its extent
 * is missing data, not a claim.
 */
const VIRTUAL_WITHOUT_SERVICE_AREA: QueryDslQueryContainer = {
  bool: {
    filter: [{ term: { locationTypes: 'virtual' } }],
    must_not: [{ exists: { field: SERVICE_AREA_FIELD } }],
  },
};

/**
 * Regions and points OR'ed; `intersects` counts border contact (v1). ES reads
 * each Region's shape from `regions` by id, so no geometry crosses the wire; a
 * point is a query-time circle. Excluding virtual services drops the global
 * branch, so only a real overlap matches.
 */
export function geographyClause(
  regionIds: readonly string[],
  points: readonly GeoPoint[],
  virtual: VirtualMode | undefined,
): QueryDslQueryContainer {
  const serves: QueryDslQueryContainer[] = [
    ...regionIds.map((id) => ({
      geo_shape: {
        [SERVICE_AREA_FIELD]: {
          indexed_shape: { index: REGIONS_INDEX, id, path: 'geometry' },
          relation: 'intersects' as const,
        },
      },
    })),
    ...points.map(({ lat, lng, radiusMiles }) => ({
      geo_shape: {
        [SERVICE_AREA_FIELD]: {
          shape: {
            type: 'circle',
            coordinates: [lng, lat],
            radius: `${radiusMiles}mi`,
          },
          relation: 'intersects' as const,
        },
      },
    })),
  ];
  if (virtual !== 'exclude') serves.push(VIRTUAL_WITHOUT_SERVICE_AREA);
  return { bool: { should: serves, minimum_should_match: 1 } };
}

/**
 * `only`: some location is virtual. `exclude`: some location is physical, so a
 * service with both kinds appears under both. `all` adds no clause.
 */
export function virtualClause(
  mode: VirtualMode | undefined,
): QueryDslQueryContainer | null {
  if (mode === 'only') return { term: { locationTypes: 'virtual' } };
  if (mode === 'exclude') return { term: { locationTypes: 'physical' } };
  return null;
}

/**
 * Canonical is `must_not false`, as Mongo's `$ne: false`: only a borrowed copy
 * is marked false, and an unflagged document is canonical.
 */
function scopeClauses(resourceWriterIds: readonly string[]) {
  return {
    filter: [
      { terms: { resourceWriterId: [...resourceWriterIds] } },
      { exists: { field: 'serviceId' } },
    ] as QueryDslQueryContainer[],
    must_not: [
      { term: { isCanonicalPublication: false } },
      { term: { serviceId: '' } },
    ] as QueryDslQueryContainer[],
  };
}

/** `null` for an empty writer set, which must return nothing, not everything. */
export function buildServiceFilter(input: ServiceFilterInput): {
  filter: QueryDslQueryContainer[];
  must_not: QueryDslQueryContainer[];
} | null {
  if (input.resourceWriterIds.length === 0) return null;
  const { filter, must_not } = scopeClauses(input.resourceWriterIds);

  // Exact terms against the loader's ancestor-expanded path. Never prefix:
  // `BD-18` is a sibling of `BD-1800`.
  if (input.taxonomyCodes && input.taxonomyCodes.length > 0) {
    filter.push({ terms: { taxonomyPath: [...input.taxonomyCodes] } });
  }
  if (input.statuses && input.statuses.length > 0) {
    filter.push({ terms: { status: [...input.statuses] } });
  }
  const regionIds = input.regionIds ?? [];
  const points = input.points ?? [];
  if (regionIds.length + points.length > 0) {
    filter.push(geographyClause(regionIds, points, input.virtual));
  }
  const virtual = virtualClause(input.virtual);
  if (virtual) filter.push(virtual);
  return { filter, must_not };
}

/** Escapes a user string for a `wildcard` query: `\\` first, then `*` and `?`. */
export function escapeWildcard(text: string): string {
  return text.replace(/[\\*?]/g, '\\$&');
}

/**
 * Departs from Mongo's name-only substring match. OR of a case-insensitive
 * contains on `name.substring` (keeps "ood" finding "Food") and an all-terms
 * `bool_prefix` over the text fields, without fuzziness.
 */
export function textClause(text: string | undefined): QueryDslQueryContainer[] {
  const trimmed = text?.trim() ?? '';
  if (trimmed === '') return [];
  return [
    {
      bool: {
        should: [
          {
            wildcard: {
              [SERVICE_NAME_SUBSTRING_FIELD]: {
                value: `*${escapeWildcard(trimmed)}*`,
                case_insensitive: true,
              },
            },
          },
          {
            multi_match: {
              query: trimmed,
              type: 'bool_prefix',
              fields: [...SERVICE_TEXT_FIELDS],
              operator: 'and',
            },
          },
        ],
        minimum_should_match: 1,
      },
    },
  ];
}

export type CursorSortValues = FieldValue[];
