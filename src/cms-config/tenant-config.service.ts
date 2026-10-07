import {
  Injectable,
  Logger,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { LRUCache } from 'lru-cache';
import qs from 'qs';
import { CmsRedisService } from './cms-redis.service';
import { MetricsService } from 'src/metrics/metrics.service';
import {
  FacetConfig,
  FacetsConfigCache,
  OrchestrationConfigCache,
  SearchConfigCache,
  SuggestionsConfigCache,
  TopicsConfigCache,
} from './types';
import { LRU_CACHE_CONFIG } from './const/lru-cache-config';

const CMS_FETCH_TIMEOUT_MS = 10_000;

@Injectable()
export class TenantConfigService {
  private readonly logger = new Logger(TenantConfigService.name);
  private readonly keycloakRealmIdCache = new LRUCache<string, string>(
    LRU_CACHE_CONFIG,
  );
  private readonly facetsCache = new LRUCache<string, FacetConfig[]>(
    LRU_CACHE_CONFIG,
  );
  private readonly localesCache = new LRUCache<string, string[]>(
    LRU_CACHE_CONFIG,
  );
  private readonly searchConfigCache = new LRUCache<string, SearchConfigCache>(
    LRU_CACHE_CONFIG,
  );
  private readonly topicsCache = new LRUCache<string, TopicsConfigCache>(
    LRU_CACHE_CONFIG,
  );
  private readonly suggestionsCache = new LRUCache<
    string,
    SuggestionsConfigCache
  >(LRU_CACHE_CONFIG);
  private readonly orchestrationConfigCache = new LRUCache<
    string,
    OrchestrationConfigCache | null
  >(LRU_CACHE_CONFIG);

  constructor(
    private readonly cmsRedisService: CmsRedisService,
    @Inject(CACHE_MANAGER) private readonly cacheService: Cache,
    private readonly configService: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  async getKeycloakRealmId(tenantId: string): Promise<string> {
    this.logger.debug(`Fetching Keycloak Realm ID for tenant: ${tenantId}`);

    const inMemoryCached = this.keycloakRealmIdCache.get(tenantId);
    if (inMemoryCached) {
      this.metrics.recordCacheAccess('tenant-config-lru', 'hit');
      this.logger.debug(
        `In-memory cache hit for Keycloak Realm ID: ${tenantId}`,
      );
      return inMemoryCached;
    }
    this.metrics.recordCacheAccess('tenant-config-lru', 'miss');

    const redisKey = `keycloak_realm_id:${tenantId}`;

    try {
      const cmsRedisValue = await this.cmsRedisService.get(redisKey);
      if (cmsRedisValue && typeof cmsRedisValue === 'string') {
        this.metrics.recordCacheAccess('tenant-config-redis', 'hit');
        this.logger.debug(`Redis DB 2 hit for Keycloak Realm ID: ${tenantId}`);
        this.keycloakRealmIdCache.set(tenantId, cmsRedisValue);
        return cmsRedisValue;
      }
    } catch (error) {
      this.metrics.recordCacheAccess('tenant-config-redis', 'get-error');
      this.logger.warn(
        `Error fetching Keycloak Realm ID from Redis DB 2 for ${tenantId}: ${error.message}`,
      );
    }
    this.metrics.recordCacheAccess('tenant-config-redis', 'miss');

    const cachedRealmId = await this.cacheService.get<string>(redisKey);
    if (cachedRealmId) {
      this.metrics.recordCacheAccess('tenant-config-app-redis', 'hit');
      this.logger.debug(`Cache hit for Keycloak Realm ID: ${tenantId}`);
      this.keycloakRealmIdCache.set(tenantId, cachedRealmId);
      return cachedRealmId;
    }
    this.metrics.recordCacheAccess('tenant-config-app-redis', 'miss');

    this.logger.debug(
      `Falling back to Strapi for Keycloak Realm ID: ${tenantId}`,
    );
    const strapiData = await this.fetchFullTenantFromStrapi(tenantId);

    if (!strapiData.keycloakRealmId) {
      throw new BadRequestException(
        `Keycloak realm configuration is missing for tenant (ID: ${tenantId})`,
      );
    }

    await this.cacheService.set(redisKey, strapiData.keycloakRealmId, 60_000);
    this.keycloakRealmIdCache.set(tenantId, strapiData.keycloakRealmId);

    return strapiData.keycloakRealmId;
  }

  async getFacets(tenantId: string): Promise<FacetConfig[]> {
    this.logger.debug(`Fetching facets for tenant: ${tenantId}`);

    const inMemoryCached = this.facetsCache.get(tenantId);
    if (inMemoryCached) {
      this.metrics.recordCacheAccess('tenant-config-lru', 'hit');
      this.logger.debug(`In-memory cache hit for facets: ${tenantId}`);
      return inMemoryCached;
    }
    this.metrics.recordCacheAccess('tenant-config-lru', 'miss');

    try {
      const redisKey = `facets:${tenantId}`;
      const redisValue = await this.cmsRedisService.get(redisKey);

      if (redisValue && typeof redisValue === 'string') {
        this.metrics.recordCacheAccess('tenant-config-redis', 'hit');
        this.logger.debug(`Redis DB 2 hit for facets: ${tenantId}`);
        const facetsCache = JSON.parse(redisValue) as FacetsConfigCache;
        if (!facetsCache.facets || !Array.isArray(facetsCache.facets)) {
          this.logger.error(
            `Invalid facets format in Redis for tenant ${tenantId}. Expected FacetsConfigCache with facets array. Got: ${redisValue}`,
          );
          const emptyFacets = [];
          this.facetsCache.set(tenantId, emptyFacets);
          return emptyFacets;
        }
        this.facetsCache.set(tenantId, facetsCache.facets);
        return facetsCache.facets;
      }
    } catch (error) {
      this.metrics.recordCacheAccess('tenant-config-redis', 'get-error');
      this.logger.error(
        `Error fetching facets from Redis DB 2 for ${tenantId}: ${error.message}`,
      );
    }
    this.metrics.recordCacheAccess('tenant-config-redis', 'miss');

    return [];
  }

  async getTenantLocales(tenantId: string): Promise<string[]> {
    this.logger.debug(`Fetching enabled locales for tenant: ${tenantId}`);

    const inMemoryCached = this.localesCache.get(tenantId);
    if (inMemoryCached) {
      this.metrics.recordCacheAccess('tenant-config-lru', 'hit');
      this.logger.debug(`In-memory cache hit for locales: ${tenantId}`);
      return inMemoryCached;
    }
    this.metrics.recordCacheAccess('tenant-config-lru', 'miss');

    try {
      const redisKey = `enabled_locales:${tenantId}`;
      const redisValue = await this.cmsRedisService.get(redisKey);

      if (redisValue && typeof redisValue === 'string') {
        this.metrics.recordCacheAccess('tenant-config-redis', 'hit');
        this.logger.debug(`Redis DB 2 hit for locales: ${tenantId}`);
        const locales: string[] = JSON.parse(redisValue);
        this.localesCache.set(tenantId, locales);
        return locales;
      }
    } catch (error) {
      this.metrics.recordCacheAccess('tenant-config-redis', 'get-error');
      this.logger.error(
        `Error fetching locales from Redis DB 2 for ${tenantId}: ${error.message}`,
      );
    }
    this.metrics.recordCacheAccess('tenant-config-redis', 'miss');

    this.logger.warn(`No enabled locales found for tenant: ${tenantId}`);
    return [];
  }

  /**
   * Reads tenant search configuration written by PayloadCMS to Redis DB 2 under
   * `search_config:${tenantId}`. Returns an empty object when missing or on
   * error so callers can safely fall back to default search behavior.
   */
  async getSearchConfig(tenantId: string): Promise<SearchConfigCache> {
    this.logger.debug(`Fetching search config for tenant: ${tenantId}`);

    const inMemoryCached = this.searchConfigCache.get(tenantId);
    if (inMemoryCached) {
      this.metrics.recordCacheAccess('tenant-config-lru', 'hit');
      this.logger.debug(`In-memory cache hit for search config: ${tenantId}`);

      return inMemoryCached;
    }
    this.metrics.recordCacheAccess('tenant-config-lru', 'miss');

    try {
      const redisKey = `search_config:${tenantId}`;
      const redisValue = await this.cmsRedisService.get(redisKey);

      if (redisValue) {
        this.metrics.recordCacheAccess('tenant-config-redis', 'hit');
        this.logger.debug(`Redis DB 2 hit for search config: ${tenantId}`);
        const searchConfig =
          typeof redisValue === 'string' ? JSON.parse(redisValue) : redisValue;
        this.searchConfigCache.set(tenantId, searchConfig);
        return searchConfig;
      }
    } catch (error) {
      this.metrics.recordCacheAccess('tenant-config-redis', 'get-error');
      this.logger.error(
        `Error fetching search config from Redis DB 2 for ${tenantId}: ${error.message}`,
      );
    }
    this.metrics.recordCacheAccess('tenant-config-redis', 'miss');

    const emptyConfig: SearchConfigCache = {};
    this.searchConfigCache.set(tenantId, emptyConfig);
    return emptyConfig;
  }

  /**
   * Reads tenant topics configuration written by PayloadCMS to Redis DB 2 under
   * `topics:${tenantId}`. Returns a default empty shape when missing or on error.
   */
  async getTopics(tenantId: string): Promise<TopicsConfigCache> {
    this.logger.debug(`Fetching topics config for tenant: ${tenantId}`);

    const inMemoryCached = this.topicsCache.get(tenantId);
    if (inMemoryCached) {
      this.metrics.recordCacheAccess('tenant-config-lru', 'hit');
      this.logger.debug(`In-memory cache hit for topics config: ${tenantId}`);
      return inMemoryCached;
    }
    this.metrics.recordCacheAccess('tenant-config-lru', 'miss');

    try {
      const redisKey = `topics:${tenantId}`;
      const redisValue = await this.cmsRedisService.get(redisKey);

      if (redisValue && typeof redisValue === 'string') {
        this.metrics.recordCacheAccess('tenant-config-redis', 'hit');
        this.logger.debug(`Redis DB 2 hit for topics config: ${tenantId}`);
        const topicsConfig = JSON.parse(redisValue) as TopicsConfigCache;
        if (!topicsConfig.list || !Array.isArray(topicsConfig.list)) {
          this.logger.error(
            `Invalid topics format in Redis for tenant ${tenantId}. Expected TopicsConfigCache with list array. Got: ${redisValue}`,
          );
          const emptyConfig = this.createEmptyTopicsConfig(tenantId);
          this.topicsCache.set(tenantId, emptyConfig);
          return emptyConfig;
        }
        this.topicsCache.set(tenantId, topicsConfig);
        return topicsConfig;
      }
    } catch (error) {
      this.metrics.recordCacheAccess('tenant-config-redis', 'get-error');
      this.logger.error(
        `Error fetching topics config from Redis DB 2 for ${tenantId}: ${error.message}`,
      );
    }
    this.metrics.recordCacheAccess('tenant-config-redis', 'miss');

    const emptyConfig = this.createEmptyTopicsConfig(tenantId);
    this.topicsCache.set(tenantId, emptyConfig);
    return emptyConfig;
  }

  private createEmptyTopicsConfig(tenantId: string): TopicsConfigCache {
    return {
      tenantId,
      iconSize: '',
      imageBorderRadius: '',
      backTexts: {},
      customHeadings: {},
      list: [],
    };
  }

  /**
   * Reads tenant suggestions configuration written by PayloadCMS to Redis DB 2
   * under `suggestions:${tenantId}`. Returns a default empty shape when missing
   * or on error.
   */
  async getSuggestions(tenantId: string): Promise<SuggestionsConfigCache> {
    this.logger.debug(`Fetching suggestions config for tenant: ${tenantId}`);

    const inMemoryCached = this.suggestionsCache.get(tenantId);
    if (inMemoryCached) {
      this.metrics.recordCacheAccess('tenant-config-lru', 'hit');
      this.logger.debug(
        `In-memory cache hit for suggestions config: ${tenantId}`,
      );
      return inMemoryCached;
    }
    this.metrics.recordCacheAccess('tenant-config-lru', 'miss');

    try {
      const redisKey = `suggestions:${tenantId}`;
      const redisValue = await this.cmsRedisService.get(redisKey);

      if (redisValue && typeof redisValue === 'string') {
        this.metrics.recordCacheAccess('tenant-config-redis', 'hit');
        this.logger.debug(`Redis DB 2 hit for suggestions config: ${tenantId}`);
        const suggestionsConfig = JSON.parse(
          redisValue,
        ) as SuggestionsConfigCache;
        if (
          !suggestionsConfig.suggestions ||
          !Array.isArray(suggestionsConfig.suggestions)
        ) {
          this.logger.error(
            `Invalid suggestions format in Redis for tenant ${tenantId}. Expected SuggestionsConfigCache with suggestions array. Got: ${redisValue}`,
          );
          const emptyConfig: SuggestionsConfigCache = {
            tenantId,
            suggestions: [],
          };
          this.suggestionsCache.set(tenantId, emptyConfig);
          return emptyConfig;
        }
        this.suggestionsCache.set(tenantId, suggestionsConfig);
        return suggestionsConfig;
      }
    } catch (error) {
      this.metrics.recordCacheAccess('tenant-config-redis', 'get-error');
      this.logger.error(
        `Error fetching suggestions config from Redis DB 2 for ${tenantId}: ${error.message}`,
      );
    }
    this.metrics.recordCacheAccess('tenant-config-redis', 'miss');

    const emptyConfig: SuggestionsConfigCache = {
      tenantId,
      suggestions: [],
    };
    this.suggestionsCache.set(tenantId, emptyConfig);
    return emptyConfig;
  }

  /**
   * Reads tenant orchestration configuration written by PayloadCMS to Redis DB 2
   * under `orchestration_config:${tenantId}`. Returns null when missing or on
   * error so the aggregate endpoint can omit it cleanly.
   */
  async getOrchestrationConfig(
    tenantId: string,
  ): Promise<OrchestrationConfigCache | null> {
    this.logger.debug(`Fetching orchestration config for tenant: ${tenantId}`);

    const inMemoryCached = this.orchestrationConfigCache.get(tenantId);
    if (inMemoryCached !== undefined) {
      this.metrics.recordCacheAccess('tenant-config-lru', 'hit');
      this.logger.debug(
        `In-memory cache hit for orchestration config: ${tenantId}`,
      );
      return inMemoryCached;
    }
    this.metrics.recordCacheAccess('tenant-config-lru', 'miss');

    try {
      const redisKey = `orchestration_config:${tenantId}`;
      const redisValue = await this.cmsRedisService.get(redisKey);

      if (redisValue && typeof redisValue === 'string') {
        this.metrics.recordCacheAccess('tenant-config-redis', 'hit');
        this.logger.debug(
          `Redis DB 2 hit for orchestration config: ${tenantId}`,
        );
        const orchestrationConfig = JSON.parse(
          redisValue,
        ) as OrchestrationConfigCache;
        this.orchestrationConfigCache.set(tenantId, orchestrationConfig);
        return orchestrationConfig;
      }
    } catch (error) {
      this.metrics.recordCacheAccess('tenant-config-redis', 'get-error');
      this.logger.error(
        `Error fetching orchestration config from Redis DB 2 for ${tenantId}: ${error.message}`,
      );
    }
    this.metrics.recordCacheAccess('tenant-config-redis', 'miss');

    this.orchestrationConfigCache.set(tenantId, null);
    return null;
  }

  /**
   *
   * @deprecated This method is only used as a fallback to fetch tenant configuration from Strapi when Redis DB 2 is unavailable or missing data.
   * It is not optimized for performance and should not be used as the primary method for fetching tenant configuration due to potential latency and load on the CMS.
   * It should be removed once all tenants are migrated from Strapi to PayloadCMS and Redis DB 2 is fully populated with the necessary tenant configuration data.
   */
  private async fetchFullTenantFromStrapi(tenantId: string): Promise<{
    keycloakRealmId: string;
    facets: FacetConfig[];
  }> {
    const strapiPopulateQuery = qs.stringify({
      populate: {
        facets: {
          populate: '*',
        },
        app_config: {
          populate: 'keycloakConfig',
        },
      },
    });

    const url = `${this.configService.get('STRAPI_URL')}/api/tenants?filters[tenantId][$eq]=${tenantId}&${strapiPopulateQuery}`;

    try {
      const response = await this.metrics.observeDownstream(
        'cms',
        'tenant_config',
        () =>
          fetch(url, {
            headers: {
              Authorization: `Bearer ${this.configService.get('STRAPI_TOKEN')}`,
            },
            signal: AbortSignal.timeout(CMS_FETCH_TIMEOUT_MS),
          }),
        (res) => (res.ok ? 'ok' : 'error'),
      );

      if (!response.ok) {
        this.logger.error(
          `Failed to fetch tenant from Strapi. Status: ${response.status}`,
        );
        throw new InternalServerErrorException(
          `Failed to fetch tenant configuration from Strapi (Status: ${response.status}).`,
        );
      }

      const res = await response.json();
      const initialData = res?.data?.[0]?.attributes;

      if (!initialData) {
        throw new BadRequestException('Tenant data not found in CMS (Strapi)');
      }

      const { app_config, ...rest } = initialData;
      const appConfig = app_config?.data?.attributes;

      return {
        keycloakRealmId: appConfig?.keycloakConfig?.keycloakRealmId || '',
        facets: rest.facets || [],
      };
    } catch (error) {
      if (
        error instanceof InternalServerErrorException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      this.logger.error(
        `Unexpected error fetching from Strapi for tenant ${tenantId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to fetch tenant configuration',
      );
    }
  }

  clearCache(): void {
    this.logger.log('Clearing all in-memory cache');
    this.keycloakRealmIdCache.clear();
    this.facetsCache.clear();
    this.localesCache.clear();
    this.searchConfigCache.clear();
    this.topicsCache.clear();
    this.suggestionsCache.clear();
    this.orchestrationConfigCache.clear();
    this.logger.log('All in-memory cache cleared');
  }

  clearCacheForTenant(tenantId: string): void {
    this.logger.log(`Clearing in-memory cache for tenant: ${tenantId}`);
    this.keycloakRealmIdCache.delete(tenantId);
    this.facetsCache.delete(tenantId);
    this.localesCache.delete(tenantId);
    this.searchConfigCache.delete(tenantId);
    this.topicsCache.delete(tenantId);
    this.suggestionsCache.delete(tenantId);
    this.orchestrationConfigCache.delete(tenantId);
    this.logger.log(`In-memory cache cleared for tenant: ${tenantId}`);
  }
}
