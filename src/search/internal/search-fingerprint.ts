import { hashCacheKey } from './cache-key/hash-cache-key';
import { normalizeTaxonomies } from './cache-key/normalize-taxonomies';

/**
 * The inputs that decide a resource search's result set and relevance ranking,
 * shared by the text and hybrid paths. Deliberately excludes `page`, `limit`
 * and `sort`: they pick a window and an order over the same results, so one
 * search keeps one identity across pages.
 */
export interface SearchIdentity {
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
}

export const searchFingerprint = (search: SearchIdentity): string =>
  hashCacheKey({
    tenantId: search.tenantId,
    lang: search.lang,
    queryStr: search.queryStr,
    filters: search.filters ?? {},
    taxonomies: normalizeTaxonomies(search.taxonomies ?? []),
    coords: search.coords ?? null,
    distance: search.distance ?? 0,
    age: search.age ?? null,
    geoType: search.geoType ?? null,
    organizationId: search.organizationId ?? null,
    geometry: search.geometry ?? null,
  });
