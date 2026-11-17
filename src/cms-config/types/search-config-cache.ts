/**
 * How pinned/priority resources are handled in search results.
 *
 * - `ignore` — do not apply any pinned/priority boost or sort tier.
 * - `boost` (default) — add `pinned_score_boost`/`priority_score_weight` as
 *   score contributions (hybrid search), with no hard sort tier. For classic
 *   (non-hybrid) search this preserves the existing priority sort tier.
 * - `top` — hard-sort pinned/priority resources to the top of results,
 *   preserving relevance scoring inside each tier.
 */
export type PinnedResourcesMode = 'ignore' | 'boost' | 'top';

/**
 * Tenant search configuration written by PayloadCMS to Redis DB 2 under
 * `search_config:${tenantId}` and read by Norse API.
 */
export interface SearchConfigCache {
  /**
   * Controls pinned/priority behavior for hybrid, AI-classification, and
   * classic search. Defaults to `boost` when absent or invalid.
   */
  pinned_resources_mode?: PinnedResourcesMode;

  /**
   * When true, organization search is enabled in the suggestion service.
   * When false (default), only taxonomy search is performed.
   */
  enable_organization_search?: boolean;

  /**
   * Default `area_match` for area searches (`region`) when the caller sends
   * none. Absent or invalid: `located_or_serving`. See docs/area-search.md.
   */
  area_match?: 'located' | 'located_or_serving' | 'serving';

  /**
   * Default `include_unlocated` for area searches when the caller sends none.
   * Absent: false.
   */
  include_unlocated_in_area_search?: boolean;
}
