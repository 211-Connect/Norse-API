import { ANALYTICS_CACHE_KEY_BUCKET_MS } from './constants';

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

/**
 * Rounds a timestamp down to the start of its bucket, so that timestamps
 * within the same bucket window collapse to a single value.
 */
function bucketMs(ms: number, bucketSizeMs: number): number {
  return Math.floor(ms / bucketSizeMs) * bucketSizeMs;
}

export const analyticsResponseCacheKey = (
  tenantId: string,
  endpoint: string,
  websiteIds: string[],
  startMs: number,
  endMs: number,
  extra?: string,
): string => {
  const ids = [...websiteIds].sort().join(',');
  const bucketedStart = bucketMs(startMs, ANALYTICS_CACHE_KEY_BUCKET_MS);
  const bucketedEnd = bucketMs(endMs, ANALYTICS_CACHE_KEY_BUCKET_MS);
  const base = `analytics_response:${tenantId}:${endpoint}:${ids}:${bucketedStart}:${bucketedEnd}`;
  return extra ? `${base}:${extra}` : base;
};
