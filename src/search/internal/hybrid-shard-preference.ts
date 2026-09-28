import { hashCacheKey } from './cache-key/hash-cache-key';
import { normalizeTaxonomies } from './cache-key/normalize-taxonomies';

/**
 * Pinned per search, never per page: each index's primary and replica score
 * differently — BM25 counts each copy's own deleted docs, and the taxonomy kNN
 * walks each copy's own HNSW graph — so a request that lands on either copy
 * returns one of up to four orderings. Excludes `page`, `limit` and `sort` so
 * paging through one search reads one set of copies.
 */
export const hybridShardPreference = (args: {
  tenantId: string;
  lang: string;
  queryStr: string;
  filters: unknown;
  taxonomies: string[];
  coords: number[] | undefined;
  distance: number | undefined;
  age: number | undefined;
  geoType: string | undefined;
  organizationId: string | undefined;
  geometry: unknown;
}): string =>
  `hybrid-${hashCacheKey({
    tenantId: args.tenantId,
    lang: args.lang,
    queryStr: args.queryStr.trim(),
    filters: args.filters ?? {},
    taxonomies: normalizeTaxonomies(args.taxonomies ?? []),
    coords: args.coords ?? null,
    distance: args.distance ?? 0,
    age: args.age ?? null,
    geoType: args.geoType ?? null,
    organizationId: args.organizationId ?? null,
    geometry: args.geometry ?? null,
  })}`;
