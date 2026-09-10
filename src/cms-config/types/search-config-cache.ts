/**
 * How pinned/priority resources are handled in hybrid/AI-classification search
 * results.
 *
 * - `ignore` — do not apply any pinned/priority boost or sort tier.
 * - `boost` (default) — add `pinned_score_boost`/`priority_score_weight` as
 *   score contributions, with no hard sort tier.
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
   * Controls pinned/priority behavior for hybrid and AI-classification search.
   * Defaults to `boost` when absent or invalid.
   */
  pinned_resources_mode?: PinnedResourcesMode;

  /**
   * When true, organization search is enabled in the suggestion service.
   * When false (default), only taxonomy search is performed.
   */
  enable_organization_search?: boolean;
}
