import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LRUCache } from 'lru-cache';

import { CmsRedisService } from '../../cms-config/cms-redis.service';
import type { AnalyticsInfo } from '../types';
import { analyticsConfigRedisKey } from '../internal/analytics-redis-keys';

const CONFIG_LRU_TTL_MS = 60 * 1_000;

@Injectable()
export class AnalyticsConfigService {
  private readonly logger = new Logger(AnalyticsConfigService.name);

  private readonly configLru: LRUCache<string, AnalyticsInfo | null>;

  constructor(
    private readonly cmsRedisService: CmsRedisService,
    private readonly configService: ConfigService,
  ) {
    const lruMax = this.configService.get<number>(
      'analytics.cache.configLruMax',
      1000,
    );
    this.configLru = new LRUCache<string, AnalyticsInfo | null>({
      max: lruMax,
      ttl: CONFIG_LRU_TTL_MS,
      noUpdateTTL: true,
    });
  }

  async getConfig(tenantId: string): Promise<AnalyticsInfo | null> {
    // L1 — in-process LRU
    if (this.configLru.has(tenantId)) {
      this.logger.debug(`Analytics config LRU hit for tenant: ${tenantId}`);
      return this.configLru.get(tenantId) ?? null;
    }

    // L2 — Redis DB 2
    const raw = await this.cmsRedisService.get(
      analyticsConfigRedisKey(tenantId),
    );
    if (!raw) {
      this.configLru.set(tenantId, null);
      return null;
    }

    try {
      const config: AnalyticsInfo =
        typeof raw === 'string'
          ? (JSON.parse(raw) as AnalyticsInfo)
          : (raw as AnalyticsInfo);
      this.configLru.set(tenantId, config);
      return config;
    } catch (err) {
      this.logger.error(
        `Failed to parse analytics config for tenant ${tenantId}: ${err}`,
      );
      this.configLru.set(tenantId, null);
      return null;
    }
  }

  async validateApiKey(tenantId: string, apiKey: string): Promise<boolean> {
    const config = await this.getConfig(tenantId);
    return config?.apiKey === apiKey;
  }

  async getWebsiteIds(
    tenantId: string,
    requestedIds: string[] = [],
  ): Promise<string[]> {
    const config = await this.getConfig(tenantId);
    if (!config) {
      throw new UnauthorizedException(
        'Analytics configuration not found for this tenant',
      );
    }

    if (requestedIds.length === 0) {
      return [config.umamiWebsiteId];
    }

    const allowed = new Set(
      config.additionalWebsiteIds
        .map((entry) => entry?.websiteId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    );
    allowed.add(config.umamiWebsiteId);
    const forbidden = requestedIds.filter((id) => !allowed.has(id));
    if (forbidden.length > 0) {
      throw new ForbiddenException(
        `Website IDs not permitted for this tenant: ${forbidden.join(', ')}`,
      );
    }

    return requestedIds;
  }
}
