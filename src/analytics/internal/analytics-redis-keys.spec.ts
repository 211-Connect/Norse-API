import {
  analyticsConfigRedisKey,
  analyticsResponseCacheKey,
  analyticsWebsiteNamesRedisKey,
} from './analytics-redis-keys';
import { ANALYTICS_CACHE_KEY_BUCKET_MS } from './constants';

describe('analyticsResponseCacheKey', () => {
  const tenantId = 'tenant-1';
  const endpoint = 'heatmap';
  const websiteIds = ['website-b', 'website-a'];

  it('sorts websiteIds so order does not affect the key', () => {
    const keyA = analyticsResponseCacheKey(
      tenantId,
      endpoint,
      ['a', 'b'],
      0,
      0,
    );
    const keyB = analyticsResponseCacheKey(
      tenantId,
      endpoint,
      ['b', 'a'],
      0,
      0,
    );

    expect(keyA).toBe(keyB);
  });

  it('appends the extra segment when provided', () => {
    const withoutExtra = analyticsResponseCacheKey(
      tenantId,
      endpoint,
      websiteIds,
      0,
      0,
    );
    const withExtra = analyticsResponseCacheKey(
      tenantId,
      endpoint,
      websiteIds,
      0,
      0,
      'UTC',
    );

    expect(withExtra).toBe(`${withoutExtra}:UTC`);
  });

  it('produces the same key for timestamps within the same minute bucket', () => {
    const bucketStart = 10 * ANALYTICS_CACHE_KEY_BUCKET_MS;

    const key1 = analyticsResponseCacheKey(
      tenantId,
      endpoint,
      websiteIds,
      bucketStart,
      bucketStart + 50_000,
    );
    const key2 = analyticsResponseCacheKey(
      tenantId,
      endpoint,
      websiteIds,
      bucketStart + 900, // 900ms jitter, still same minute bucket
      bucketStart + 50_900,
    );

    expect(key1).toBe(key2);
  });

  it('produces a different key once timestamps cross a minute boundary', () => {
    const bucketStart = 10 * ANALYTICS_CACHE_KEY_BUCKET_MS;

    const key1 = analyticsResponseCacheKey(
      tenantId,
      endpoint,
      websiteIds,
      bucketStart,
      bucketStart + 50_000,
    );
    const key2 = analyticsResponseCacheKey(
      tenantId,
      endpoint,
      websiteIds,
      bucketStart + ANALYTICS_CACHE_KEY_BUCKET_MS, // next bucket
      bucketStart + 50_000 + ANALYTICS_CACHE_KEY_BUCKET_MS,
    );

    expect(key1).not.toBe(key2);
  });

  it('rounds startMs/endMs down to the bucket boundary in the key string', () => {
    const bucketStart = 10 * ANALYTICS_CACHE_KEY_BUCKET_MS;
    const key = analyticsResponseCacheKey(
      tenantId,
      endpoint,
      websiteIds,
      bucketStart + 1_234,
      bucketStart + 55_555,
    );

    expect(key).toBe(
      `analytics_response:${tenantId}:${endpoint}:website-a,website-b:${bucketStart}:${bucketStart}`,
    );
  });
});

describe('analyticsConfigRedisKey', () => {
  it('builds a key namespaced by tenant', () => {
    expect(analyticsConfigRedisKey('tenant-1')).toBe(
      'analytics_config:tenant-1',
    );
  });
});

describe('analyticsWebsiteNamesRedisKey', () => {
  it('builds a key namespaced by tenant', () => {
    expect(analyticsWebsiteNamesRedisKey('tenant-1')).toBe(
      'analytics_website_names:tenant-1',
    );
  });
});
