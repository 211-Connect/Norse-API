import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadGatewayException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import {
  TenantAppConfigService,
  toLngLat,
  toTenantAppConfig,
} from './tenant-app-config.service';
import { MetricsService } from 'src/metrics/metrics.service';
import { createMetricsServiceMock } from 'src/metrics/testing/metrics-service.mock';

const TENANT = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

const payloadAppConfig = {
  tenantId: TENANT,
  brand: {
    name: 'Example 211',
    logoUrl: 'https://example.org/logo.png',
    theme: {
      primaryColor: '#123456',
      secondaryColor: '#abcdef',
      borderRadius: '8px',
    },
  },
  search: {
    map: { center: [-122.33, 47.6], zoom: 9 },
    defaultRadius: 25,
    resultsLimit: 25,
  },
  alerts: [
    {
      text: 'Office closed Monday',
      buttonText: 'Details',
      url: 'https://example.org/closed',
      target: '_blank',
      variant: 'default',
    },
  ],
  sms: { provider: 'Twilio' },
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('TenantAppConfigService', () => {
  let service: TenantAppConfigService;
  let metricsMock: ReturnType<typeof createMetricsServiceMock>;
  let config: Record<string, string | undefined>;
  let fetchMock: jest.SpyInstance;

  const recordCalls = () =>
    metricsMock.recordCacheAccess.mock.calls.map(
      ([cache, result]) => `${cache}:${result}`,
    );

  beforeEach(async () => {
    config = {
      PAYLOAD_URL: 'https://payload.example.org/',
      PAYLOAD_APP_CONFIG_API_KEY: 'payload-key',
    };
    metricsMock = createMetricsServiceMock();
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async () => jsonResponse(payloadAppConfig));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantAppConfigService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => config[key]) },
        },
        { provide: MetricsService, useValue: metricsMock },
      ],
    }).compile();

    service = module.get(TenantAppConfigService);
  });

  afterEach(() => fetchMock.mockRestore());

  it("calls Payload's tenant config route with the bearer key and locale", async () => {
    await service.getAppConfig(TENANT, 'es');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      `https://payload.example.org/api/tenants/${TENANT}/config?locale=es`,
    );
    expect(init.headers).toEqual({ Authorization: 'Bearer payload-key' });
    expect(metricsMock.observeDownstream).toHaveBeenCalledWith(
      'cms',
      'tenant_app_config',
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('returns only the branding, map, radius and alert fields', async () => {
    await expect(service.getAppConfig(TENANT, 'en')).resolves.toEqual({
      tenantId: TENANT,
      brand: {
        theme: {
          primaryColor: '#123456',
          secondaryColor: '#abcdef',
          borderRadius: '8px',
        },
      },
      search: { map: { center: [-122.33, 47.6], zoom: 9 }, defaultRadius: 25 },
      alerts: [
        {
          text: 'Office closed Monday',
          buttonText: 'Details',
          url: 'https://example.org/closed',
          target: '_blank',
          variant: 'default',
        },
      ],
    });
  });

  it('serves repeat requests from the LRU, per tenant and locale', async () => {
    await service.getAppConfig(TENANT, 'en');
    await service.getAppConfig(TENANT, 'en');
    await service.getAppConfig(TENANT, 'es');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(recordCalls()).toEqual([
      'tenant-app-config-lru:miss',
      'tenant-app-config-lru:hit',
      'tenant-app-config-lru:miss',
    ]);
  });

  it('shares one Payload call between concurrent misses', async () => {
    const results = await Promise.all([
      service.getAppConfig(TENANT, 'en'),
      service.getAppConfig(TENANT, 'en'),
      service.getAppConfig(TENANT, 'en'),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results[1]).toEqual(results[0]);
    expect(recordCalls()).toEqual([
      'tenant-app-config-lru:miss',
      'tenant-app-config-lru:coalesced',
      'tenant-app-config-lru:coalesced',
    ]);
  });

  it('does not cache a failure; the next request retries Payload', async () => {
    fetchMock.mockImplementationOnce(async () => jsonResponse({}, 500));

    await expect(service.getAppConfig(TENANT, 'en')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    await expect(service.getAppConfig(TENANT, 'en')).resolves.toMatchObject({
      tenantId: TENANT,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('clearCacheForTenant forces the next request back to Payload', async () => {
    await service.getAppConfig(TENANT, 'en');
    service.clearCacheForTenant(TENANT);
    await service.getAppConfig(TENANT, 'en');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps a Payload 404 to 404', async () => {
    fetchMock.mockImplementationOnce(
      async () =>
        new Response('Tenant or resource directory not found', { status: 404 }),
    );

    await expect(service.getAppConfig(TENANT, 'en')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('maps a timeout to 503', async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new DOMException('timed out', 'TimeoutError');
    });

    await expect(service.getAppConfig(TENANT, 'en')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('maps a network failure to 502', async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('fetch failed');
    });

    await expect(service.getAppConfig(TENANT, 'en')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('fails with 500 and no request when Payload is not configured', async () => {
    config.PAYLOAD_APP_CONFIG_API_KEY = undefined;

    await expect(service.getAppConfig(TENANT, 'en')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('toLngLat', () => {
  it('keeps a longitude-first center', () => {
    expect(toLngLat([-107.290283, 43.07597])).toEqual([-107.290283, 43.07597]);
  });

  it("swaps Payload's latitude-first fallback (center of the USA)", () => {
    expect(toLngLat([39.8283459, -98.5794797])).toEqual([
      -98.5794797, 39.8283459,
    ]);
  });

  it('passes on an ambiguous pair (both within ±90) as stored', () => {
    expect(toLngLat([-75.16, 39.95])).toEqual([-75.16, 39.95]);
  });

  it('rejects pairs that are no coordinate in either order', () => {
    expect(toLngLat([200, 10])).toBeNull();
    expect(toLngLat([100, 100])).toBeNull();
    expect(toLngLat([1, 2, 3])).toBeNull();
    expect(toLngLat('[-98, 39]')).toBeNull();
  });
});

describe('toTenantAppConfig', () => {
  it('returns the fallback center longitude first', () => {
    expect(
      toTenantAppConfig(TENANT, {
        search: { map: { center: [39.8283459, -98.5794797], zoom: 7 } },
      }).search.map,
    ).toEqual({ center: [-98.5794797, 39.8283459], zoom: 7 });
  });

  it('drops malformed fields instead of passing them on', () => {
    expect(
      toTenantAppConfig(TENANT, {
        brand: { theme: { primaryColor: '', secondaryColor: 7 } },
        search: { map: { center: [1, 'x'] }, defaultRadius: '25' },
        alerts: [{ text: '' }, { buttonText: 'OK' }, 'oops', { text: 'Hi' }],
      }),
    ).toEqual({
      tenantId: TENANT,
      brand: { theme: {} },
      search: { map: { center: null } },
      alerts: [{ text: 'Hi' }],
    });
  });

  it('returns empty sections when Payload omits them', () => {
    expect(toTenantAppConfig(TENANT, {})).toEqual({
      tenantId: TENANT,
      brand: { theme: {} },
      search: { map: { center: null } },
      alerts: [],
    });
  });
});
