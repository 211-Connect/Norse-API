/**
 * Tenant search configuration written by PayloadCMS to Redis DB 2 under
 * `search_config:${tenantId}` and read by Norse API.
 */
export interface SearchConfigCache {
  /**
   * When true, hybrid search stops sorting pinned resources first and instead
   * applies a small score boost to pinned (and priority) resources. When false
   * (default), pinned/priority remain hard primary sort tiers.
   */
  boost_pinned_resources?: boolean;

  /**
   * When true, organization search is enabled in the suggestion service.
   * When false (default), only taxonomy search is performed.
   */
  organization_search_enabled?: boolean;
}
