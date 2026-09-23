import { hashCacheKey } from './hash-cache-key';
import { normalizeTaxonomies } from './normalize-taxonomies';

/**
 * Keyed on everything that changes the relevance ranking, so pages 2..n of the
 * same search reuse one probe instead of re-running it. Deliberately excludes
 * `page` and `limit` (the cut is a property of the result set, not the page)
 * and `sort` (the cut is computed on relevance, then the caller's sort orders
 * whatever survived).
 *
 * `pinnedMode` *is* included, because the probe reads it: under `ignore` the
 * pinned boost clause is dropped entirely, which moves every score and can move
 * the elbow. Excluding it meant a tenant config change served a probe computed
 * under the old mode until the entry expired.
 *
 * Two inputs are still absent and cannot be keyed from here: the query
 * embedding and the predicted taxonomy codes. Both are derived from
 * `queryStr` + tenant, so they are stable for a stable model — but they move
 * when the embedding model is swapped or when ml-broker's tenant vocabulary
 * changes (ISS-1755), and a stale probe survives until the TTL. That window is
 * why `CUTOFF_PROBE_TTL_MS` is minutes rather than the cache default's hour.
 */
export const relevanceCutoffCacheKey = (args: {
  tenantId: string;
  lang: string;
  queryStr: string;
  filters: unknown;
  taxonomies: string[];
  coords: number[] | undefined;
  distance: number;
  age: number | undefined;
  geoType: string | undefined;
  organizationId: string | undefined;
  geometry: unknown;
  pinnedMode: string;
}): string => {
  const { tenantId, lang } = args;

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
    pinnedMode: args.pinnedMode,
  });

  return `search:cutoff:${tenantId}:${lang}:${fingerprint}`;
};
