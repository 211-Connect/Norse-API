import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LRUCache } from 'lru-cache';
import { MetricsService } from 'src/metrics/metrics.service';
import { LRU_CACHE_CONFIG } from './const/lru-cache-config';
import { TenantAppConfig, TenantAppConfigAlert } from './types';

const PAYLOAD_FETCH_TIMEOUT_MS = 5_000;

const THEME_FIELDS = [
  'primaryColor',
  'secondaryColor',
  'borderRadius',
] as const;
const ALERT_FIELDS = ['buttonText', 'url', 'target', 'variant'] as const;

/**
 * A tenant's branding, map view, default radius and alerts, read from
 * Payload's `GET /api/tenants/:id/config` — the same AppConfig the Norse
 * website renders from — so clients reach it through the API gateway.
 *
 * Caching mirrors Norse's own read of that config: a one-minute in-process
 * LRU per tenant and locale, and one Payload call per key at a time. Payload
 * answers from its Redis copy of the AppConfig, which its save hooks clear,
 * so a change in Payload reaches clients within about two minutes. Failures
 * are never cached: the next request retries.
 */
@Injectable()
export class TenantAppConfigService {
  private readonly logger = new Logger(TenantAppConfigService.name);
  private readonly cache = new LRUCache<string, TenantAppConfig>(
    LRU_CACHE_CONFIG,
  );
  private readonly inFlight = new Map<string, Promise<TenantAppConfig>>();

  constructor(
    private readonly configService: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  async getAppConfig(
    tenantId: string,
    locale: string,
  ): Promise<TenantAppConfig> {
    const key = `${tenantId}:${locale}`;

    const cached = this.cache.get(key);
    if (cached) {
      this.metrics.recordCacheAccess('tenant-app-config-lru', 'hit');
      return cached;
    }

    const pending = this.inFlight.get(key);
    if (pending) {
      this.metrics.recordCacheAccess('tenant-app-config-lru', 'coalesced');
      return pending;
    }
    this.metrics.recordCacheAccess('tenant-app-config-lru', 'miss');

    const request = this.fetchFromPayload(tenantId, locale)
      .then((config) => {
        this.cache.set(key, config);
        return config;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, request);
    return request;
  }

  clearCache(): void {
    this.cache.clear();
  }

  clearCacheForTenant(tenantId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${tenantId}:`)) this.cache.delete(key);
    }
  }

  private async fetchFromPayload(
    tenantId: string,
    locale: string,
  ): Promise<TenantAppConfig> {
    const baseUrl = this.configService
      .get<string>('PAYLOAD_URL')
      ?.replace(/\/+$/, '');
    const apiKey = this.configService.get<string>('PAYLOAD_APP_CONFIG_API_KEY');
    if (!baseUrl || !apiKey) {
      this.logger.error(
        'PAYLOAD_URL or PAYLOAD_APP_CONFIG_API_KEY is not set; cannot load tenant app config',
      );
      throw new InternalServerErrorException(
        'Tenant app config is not available',
      );
    }

    const url = new URL(
      `${baseUrl}/api/tenants/${encodeURIComponent(tenantId)}/config`,
    );
    url.searchParams.set('locale', locale);

    let response: Response;
    try {
      response = await this.metrics.observeDownstream(
        'cms',
        'tenant_app_config',
        () =>
          fetch(url, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(PAYLOAD_FETCH_TIMEOUT_MS),
          }),
        (res) => (res.ok ? 'ok' : 'error'),
      );
    } catch (error) {
      const name = (error as Error)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        this.logger.warn(
          `Payload timed out loading app config for tenant ${tenantId}`,
        );
        throw new ServiceUnavailableException('Tenant app config timed out');
      }
      this.logger.error(
        `Payload request failed for tenant ${tenantId}: ${(error as Error)?.message}`,
      );
      throw new BadGatewayException('Tenant app config request failed');
    }

    if (response.status === 404) {
      throw new NotFoundException('Tenant app config not found');
    }
    if (response.status === 400) {
      throw new BadRequestException('Invalid locale');
    }
    if (!response.ok) {
      this.logger.error(
        `Payload answered ${response.status} loading app config for tenant ${tenantId}`,
      );
      throw new BadGatewayException('Tenant app config request failed');
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new BadGatewayException('Tenant app config was not JSON');
    }
    if (!isRecord(body)) {
      throw new BadGatewayException('Tenant app config was not an object');
    }

    return toTenantAppConfig(tenantId, body);
  }
}

/** Picks the fields Norse-API passes on, dropping anything malformed. */
export function toTenantAppConfig(
  tenantId: string,
  appConfig: Record<string, unknown>,
): TenantAppConfig {
  const brand = asRecord(appConfig.brand);
  const search = asRecord(appConfig.search);
  const map = asRecord(search.map);

  return {
    tenantId,
    brand: { theme: pickStrings(asRecord(brand.theme), THEME_FIELDS) },
    search: {
      map: {
        center: toLngLat(map.center),
        ...(isFiniteNumber(map.zoom) && { zoom: map.zoom }),
      },
      ...(isFiniteNumber(search.defaultRadius) && {
        defaultRadius: search.defaultRadius,
      }),
    },
    alerts: (Array.isArray(appConfig.alerts) ? appConfig.alerts : [])
      .filter(isRecord)
      .filter((alert) => typeof alert.text === 'string' && alert.text !== '')
      .map((alert): TenantAppConfigAlert => ({
        text: alert.text as string,
        ...pickStrings(alert, ALERT_FIELDS),
      })),
  };
}

function pickStrings<K extends string>(
  source: Record<string, unknown>,
  fields: readonly K[],
): Partial<Record<K, string>> {
  const picked: Partial<Record<K, string>> = {};
  for (const field of fields) {
    const value = source[field];
    if (typeof value === 'string' && value !== '') picked[field] = value;
  }
  return picked;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Payload's map center as `[longitude, latitude]`, which is what Mapbox,
 * MapLibre and the mobile app read, or null when it is not a coordinate.
 *
 * Payload's fallback for a directory without a center is latitude first
 * (`[39.8283459, -98.5794797]`, buildAppConfig in Norse), and centers migrated
 * from Strapi may be too. A pair whose second value is outside ±90 cannot be a
 * latitude, so it is swapped. A pair with both values within ±90 is ambiguous
 * and passed on as stored.
 */
export function toLngLat(value: unknown): [number, number] | null {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every(isFiniteNumber)
  ) {
    return null;
  }
  const [first, second] = value as [number, number];
  const isLngLat = Math.abs(first) <= 180 && Math.abs(second) <= 90;
  if (isLngLat) return [first, second];
  const isLatLng = Math.abs(first) <= 90 && Math.abs(second) <= 180;
  return isLatLng ? [second, first] : null;
}
