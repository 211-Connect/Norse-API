import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { LRUCache } from 'lru-cache';

import { analyticsWebsiteNamesRedisKey } from '../internal/analytics-redis-keys';
import { ANALYTICS_CACHE_TTL_CATALOG_MS } from '../internal/constants';
import { UmamiHttpService } from './umami-http.service';
import { UmamiAuthService } from './umami-auth.service';
import type { AnalyticsInfo, WebsiteName } from '../types';

@Injectable()
export class AnalyticsInfoEnricherService {
  private readonly logger = new Logger(AnalyticsInfoEnricherService.name);

  private readonly namesLru: LRUCache<string, WebsiteName[]>;

  private readonly inflight = new Map<string, Promise<WebsiteName[]>>();

  constructor(
    private readonly umamiHttpService: UmamiHttpService,
    private readonly umamiAuth: UmamiAuthService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    this.namesLru = new LRUCache<string, WebsiteName[]>({
      max: 500,
      ttl: ANALYTICS_CACHE_TTL_CATALOG_MS,
      noUpdateTTL: true,
    });
  }

  async getWebsiteNames(
    tenantId: string,
    config: AnalyticsInfo,
  ): Promise<WebsiteName[]> {
    const key = analyticsWebsiteNamesRedisKey(tenantId);

    const l1Hit = this.namesLru.get(key);
    if (l1Hit !== undefined) return l1Hit;

    const existing = this.inflight.get(key);
    if (existing) return existing;

    const promise = this.fetchNames(config, key);
    this.inflight.set(key, promise);

    promise
      .catch(() => {})
      .finally(() => {
        this.inflight.delete(key);
      });

    return promise;
  }

  private async fetchNames(
    config: AnalyticsInfo,
    redisKey: string,
  ): Promise<WebsiteName[]> {
    try {
      const l2Hit = await this.cacheManager.get<WebsiteName[]>(redisKey);
      if (l2Hit !== undefined && l2Hit !== null) {
        this.namesLru.set(redisKey, l2Hit);
        return l2Hit;
      }
    } catch (err) {
      this.logger.warn(
        `Redis get failed for website names key ${redisKey}: ${err}`,
      );
    }

    const websiteIds = [
      config.umamiWebsiteId,
      ...config.additionalWebsiteIds.map((entry) => entry.websiteId),
    ].filter((id): id is string => typeof id === 'string' && id.length > 0);

    if (websiteIds.length === 0) {
      const empty: WebsiteName[] = [];
      this.namesLru.set(redisKey, empty);
      return empty;
    }

    const token = await this.umamiAuth.getToken();

    const results = await Promise.all(
      websiteIds.map(async (id) => {
        try {
          return await this.umamiHttpService.fetchWebsite(id, token);
        } catch (err) {
          this.logger.warn(
            `Failed to fetch website name for ${id}: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
          return { id, name: id };
        }
      }),
    );

    try {
      await this.cacheManager.set(
        redisKey,
        results,
        ANALYTICS_CACHE_TTL_CATALOG_MS,
      );
    } catch (err) {
      this.logger.warn(
        `Redis set failed for website names key ${redisKey}: ${err}`,
      );
    }

    this.namesLru.set(redisKey, results);
    return results;
  }
}
