import { hashCacheKey } from './hash-cache-key';
import { normalizeTaxonomies } from './normalize-taxonomies';

/**
 * Keyed on everything that changes the relevance ranking, so pages 2..n of the
 * same search reuse one probe instead of re-running it. Deliberately excludes
 * `page` and `limit` (the cut is a property of the result set, not the page)
 * and `sort` (the cut is computed on relevance, then the caller's sort orders
 * whatever survived).
 */
export const relevanceCutoffCacheKey = (args: {
  tenantId: string;
  lang: string;
  queryStr: string;
  strategy: string;
  filters: unknown;
  taxonomies: string[];
  coords: number[] | undefined;
  distance: number;
  age: number | undefined;
  geoType: string | undefined;
  organizationId: string | undefined;
  geometry: unknown;
}): string => {
  const { tenantId, lang, strategy } = args;

  const fingerprint = hashCacheKey({
    queryStr: args.queryStr,
    filters: args.filters ?? {},
    taxonomies: normalizeTaxonomies(args.taxonomies ?? []),
    coords: args.coords ?? null,
    distance: args.distance ?? 0,
    age: args.age ?? null,
    geoType: args.geoType ?? null,
    organizationId: args.organizationId ?? null,
    geometry: args.geometry ?? null,
  });

  return `search:cutoff:${strategy}:${tenantId}:${lang}:${fingerprint}`;
};
