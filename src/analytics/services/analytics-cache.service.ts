import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { LRUCache } from 'lru-cache';

import { analyticsResponseCacheKey } from '../internal/analytics-redis-keys';
import {
  ANALYTICS_CACHE_TTL_CATALOG_MS,
  ANALYTICS_CACHE_TTL_CLOSED_RANGE_MS,
  ANALYTICS_CACHE_TTL_OPEN_RANGE_MS,
} from '../internal/constants';
import { isClosedRange } from '../internal/analytics-cache-ttl';

@Injectable()
export class AnalyticsCacheService {
  private readonly logger = new Logger(AnalyticsCacheService.name);

  private readonly lru: LRUCache<string, unknown>;

  private readonly inflight = new Map<string, Promise<unknown>>();

  private readonly sessionTtlMs: number;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly configService: ConfigService,
  ) {
    const lruMax = this.configService.get<number>(
      'analytics.cache.responseLruMax',
      500,
    );
    this.sessionTtlMs = this.configService.get<number>(
      'analytics.cache.sessionTtlMs',
      60_000,
    );

    this.lru = new LRUCache<string, unknown>({
      max: lruMax,
      ttl: 60 * 1_000, // 1 minute
      noUpdateTTL: true,
    });
  }

  async getOrSet<T>(
    tenantId: string,
    endpoint: string,
    websiteIds: string[],
    startMs: number,
    endMs: number,
    factory: () => Promise<T>,
    timezone?: string,
    extra?: string,
  ): Promise<T> {
    // The timezone affects both the TTL decision and the cache key, so
    // timezone-sensitive responses (pageviews, metrics) don't collide.
    // `extra` is for other endpoint-specific key segments (e.g. pagination).
    const keyExtra = extra ?? timezone;
    const key = analyticsResponseCacheKey(
      tenantId,
      endpoint,
      websiteIds,
      startMs,
      endMs,
      keyExtra,
    );

    // L1 — in-process LRU
    const l1Hit = this.lru.get(key);
    if (l1Hit !== undefined) {
      this.logger.debug(`Analytics LRU hit: ${key}`);
      return l1Hit as T;
    }

    // Coalesce concurrent identical requests
    const existing = this.inflight.get(key);
    if (existing) {
      this.logger.debug(`Analytics request coalesced: ${key}`);
      return existing as Promise<T>;
    }

    const promise = this.fetchAndCache(key, endpoint, endMs, factory, timezone);
    this.inflight.set(key, promise);

    promise
      .catch(() => {
        // errors are already logged inside fetchAndCache
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    return promise;
  }

  private async fetchAndCache<T>(
    key: string,
    endpoint: string,
    endMs: number,
    factory: () => Promise<T>,
    timezone?: string,
  ): Promise<T> {
    // L2 — Redis
    try {
      const l2Hit = await this.cacheManager.get<T>(key);
      if (l2Hit !== undefined && l2Hit !== null) {
        this.logger.debug(`Analytics Redis hit: ${key}`);
        this.lru.set(key, l2Hit as unknown);
        return l2Hit;
      }
    } catch (err) {
      // Redis unavailability must not block the request
      this.logger.warn(`Analytics Redis get failed for ${key}: ${err}`);
    }

    // Cache miss — fetch from Umami
    this.logger.debug(`Analytics cache miss: ${key}`);
    const result = await factory();

    const redisTtlMs = this.resolveRedisTtl(endpoint, endMs, timezone);

    this.lru.set(key, result);

    try {
      await this.cacheManager.set(key, result, redisTtlMs);
    } catch (err) {
      this.logger.warn(`Analytics Redis set failed for ${key}: ${err}`);
    }

    return result;
  }

  private resolveRedisTtl(
    endpoint: string,
    endMs: number,
    timezone?: string,
  ): number {
    if (endpoint === 'sessions') {
      return this.sessionTtlMs;
    }

    if (endpoint === 'event-catalog') {
      return ANALYTICS_CACHE_TTL_CATALOG_MS;
    }

    return isClosedRange(endMs, timezone)
      ? ANALYTICS_CACHE_TTL_CLOSED_RANGE_MS
      : ANALYTICS_CACHE_TTL_OPEN_RANGE_MS;
  }
}
