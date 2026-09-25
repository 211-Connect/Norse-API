import {
  QueryDslQueryContainer,
  Sort,
} from '@elastic/elasticsearch/lib/api/types';

/**
 * Query building for the ES `services` index (ADR 0022), mirroring ServiceNet's
 * Mongo `buildQuery` in `sharing-mongo/src/record-source.ts` clause for clause.
 * Only text search deliberately differs; see `textClause`.
 */

export const SERVICES_INDEX = 'services';

/** ES refuses `from + size` beyond `index.max_result_window` (default 10,000). */
export const SERVICES_MAX_RESULT_WINDOW = 10_000;

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

/**
 * Name, then serviceId, never score. `name.raw` is a case-sensitive keyword, so
 * this is Mongo's binary `{name: 1}` order; a missing name sorts first, as a
 * null does in Mongo. The serviceId tiebreak keeps pages stable across a
 * many-way name tie.
 */
export const SERVICE_LIST_SORT: Sort = [
  { 'name.raw': { order: 'asc', missing: '_first' } },
  { serviceId: { order: 'asc' } },
];

export interface ServiceFilterInput {
  resourceWriterIds: readonly string[];
  taxonomyCodes?: readonly string[];
  statuses?: readonly string[];
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
  return { filter, must_not };
}

/**
 * The one deliberate departure from Mongo, which matched a case-insensitive
 * substring of `name` alone. Every term must appear in one field, and the last
 * term may be a prefix, so a half-typed word still narrows the list as the
 * regex did. No fuzziness: results are ordered by name, not score, so a fuzzy
 * match would land among exact ones with nothing to tell them apart.
 */
export function textClause(text: string | undefined): QueryDslQueryContainer[] {
  const trimmed = text?.trim() ?? '';
  if (trimmed === '') return [];
  return [
    {
      multi_match: {
        query: trimmed,
        type: 'bool_prefix',
        fields: [...SERVICE_TEXT_FIELDS],
        operator: 'and',
      },
    },
  ];
}
