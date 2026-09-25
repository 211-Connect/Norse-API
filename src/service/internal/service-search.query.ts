import {
  FieldValue,
  QueryDslQueryContainer,
  Sort,
} from '@elastic/elasticsearch/lib/api/types';
import { REGIONS_INDEX } from '../../region/internal/region.query';
import { VirtualMode } from './dto';

/**
 * Query building for the ES `services` index (ADR 0023), mirroring ServiceNet's
 * Mongo `buildQuery` in `sharing-mongo/src/record-source.ts` clause for clause.
 * Text search and its ordering deliberately differ; see `textClause` and
 * `serviceListSort`.
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
 * Without text: name, then serviceId. `name.raw` is a case-sensitive keyword,
 * so this is Mongo's binary `{name: 1}` order, and a missing name sorts first,
 * as a null does in Mongo.
 *
 * With text: score, then serviceId. This is a deliberate change from Mongo,
 * which kept name order for a search.
 *
 * `serviceId` is the tie-breaker in both, and `search_after` needs it: without
 * a unique last key, a page boundary inside a tie skips or repeats records.
 */
export function serviceListSort(mode: SortMode): Sort {
  return mode === 'score'
    ? [{ _score: { order: 'desc' } }, { serviceId: { order: 'asc' } }]
    : [
        { 'name.raw': { order: 'asc', missing: '_first' } },
        { serviceId: { order: 'asc' } },
      ];
}

export interface ServiceFilterInput {
  resourceWriterIds: readonly string[];
  taxonomyCodes?: readonly string[];
  statuses?: readonly string[];
  regionIds?: readonly string[];
  virtual?: VirtualMode;
}

/** The field Dagster #601 loads with the union of a service's Service Areas. */
export const SERVICE_AREA_FIELD = 'service_area';

/**
 * Regions OR'ed: a service matches when its `service_area` intersects any of
 * them. `intersects` counts border contact (v1). ES reads each Region's shape
 * from the `regions` index by id, so the geometry never crosses the wire, and a
 * service without a `service_area` cannot match.
 */
export function geographyClause(
  regionIds: readonly string[],
): QueryDslQueryContainer {
  return {
    bool: {
      should: regionIds.map((id) => ({
        geo_shape: {
          [SERVICE_AREA_FIELD]: {
            indexed_shape: { index: REGIONS_INDEX, id, path: 'geometry' },
            relation: 'intersects',
          },
        },
      })),
      minimum_should_match: 1,
    },
  };
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
 * The scope every read carries: the writer set, canonical publications only, and
 * a usable serviceId.
 *
 * Canonical is `must_not false`, not `term true`, as Mongo's `$ne: false`: the
 * producer marks only a borrowed copy false, and a document without the flag is
 * canonical.
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

/**
 * The filter a page and its total share, or `null` for an empty writer set,
 * which must return nothing rather than an unscoped query.
 */
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
  if (input.regionIds && input.regionIds.length > 0) {
    filter.push(geographyClause(input.regionIds));
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
 * The deliberate departure from Mongo, which matched a case-insensitive
 * substring of `name` alone. Two ways to match, OR'd:
 *
 * - a case-insensitive contains match on `name.substring`, which keeps
 *   Mongo's mid-word behaviour ("ood" finds "Food")
 * - a `multi_match` over name (weighted highest), alternate name, description
 *   and organization name. Every term must appear in one field, and the last
 *   term may be a prefix. No fuzziness.
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
