export const analyticsConfigPrefix = 'analytics_config:';
export const analyticsConfigRedisKey = (tenantId: string) =>
  `${analyticsConfigPrefix}${tenantId}`;

/**
 * Cache key for a resolved analytics response.
 *
 * Sorted websiteIds ensure that `[a,b]` and `[b,a]` map to the same key.
 * The optional `extra` segment carries endpoint-specific params (e.g. timezone).
 */
export const analyticsWebsiteNamesPrefix = 'analytics_website_names:';
export const analyticsWebsiteNamesRedisKey = (tenantId: string) =>
  `${analyticsWebsiteNamesPrefix}${tenantId}`;

export const analyticsResponseCacheKey = (
  tenantId: string,
  endpoint: string,
  websiteIds: string[],
  startMs: number,
  endMs: number,
  extra?: string,
): string => {
  const ids = [...websiteIds].sort().join(',');
  const base = `analytics_response:${tenantId}:${endpoint}:${ids}:${startMs}:${endMs}`;
  return extra ? `${base}:${extra}` : base;
};
