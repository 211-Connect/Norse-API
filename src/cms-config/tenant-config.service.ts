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
import qs from 'qs';
import { CmsRedisService } from './cms-redis.service';
import { FacetConfig, FacetsConfigCache } from './types';

@Injectable()
export class TenantConfigService {
  private readonly logger = new Logger(TenantConfigService.name);

  constructor(
    private readonly cmsRedisService: CmsRedisService,
    @Inject(CACHE_MANAGER) private readonly cacheService: Cache,
    private readonly configService: ConfigService,
  ) {}

  async getKeycloakRealmId(tenantId: string): Promise<string> {
    this.logger.debug(`Fetching Keycloak Realm ID for tenant: ${tenantId}`);
    const redisKey = `keycloak_realm_id:${tenantId}`;

    try {
      const cmsRedisValue = await this.cmsRedisService.get(redisKey);
      if (cmsRedisValue && typeof cmsRedisValue === 'string') {
        this.logger.debug(`Redis DB 2 hit for Keycloak Realm ID: ${tenantId}`);
        return cmsRedisValue;
      }
    } catch (error) {
      this.logger.warn(
        `Error fetching Keycloak Realm ID from Redis DB 2 for ${tenantId}: ${error.message}`,
      );
    }

    const cachedRealmId = await this.cacheService.get<string>(redisKey);
    if (cachedRealmId) {
      this.logger.debug(`Cache hit for Keycloak Realm ID: ${tenantId}`);
      return cachedRealmId;
    }

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

    return strapiData.keycloakRealmId;
  }

  async getFacets(tenantId: string): Promise<FacetConfig[]> {
    this.logger.debug(`Fetching facets for tenant: ${tenantId}`);

    try {
      const redisKey = `facets:${tenantId}`;
      const redisValue = await this.cmsRedisService.get(redisKey);

      if (redisValue && typeof redisValue === 'string') {
        this.logger.debug(`Redis DB 2 hit for facets: ${tenantId}`);
        const facetsCache = JSON.parse(redisValue) as FacetsConfigCache;
        if (!facetsCache.facets || !Array.isArray(facetsCache.facets)) {
          this.logger.error(
            `Invalid facets format in Redis for tenant ${tenantId}. Expected FacetsConfigCache with facets array. Got: ${redisValue}`,
          );
          return [];
        }
        return facetsCache.facets;
      }
    } catch (error) {
      this.logger.error(
        `Error fetching facets from Redis DB 2 for ${tenantId}: ${error.message}`,
      );
    }

    return [];
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
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.configService.get('STRAPI_TOKEN')}`,
        },
      });

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
}
