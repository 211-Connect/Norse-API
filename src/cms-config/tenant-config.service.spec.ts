import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

import { TenantConfigService } from './tenant-config.service';
import { CmsRedisService } from './cms-redis.service';
import { MetricsService } from 'src/metrics/metrics.service';
import { createMetricsServiceMock } from 'src/metrics/testing/metrics-service.mock';

describe('TenantConfigService cache metrics', () => {
  let service: TenantConfigService;
  let cmsRedisService: { get: jest.Mock };
  let cacheManager: { get: jest.Mock; set: jest.Mock };
  let metricsMock: ReturnType<typeof createMetricsServiceMock>;

  const recordCalls = () =>
    metricsMock.recordCacheAccess.mock.calls.map(
      ([cache, result]) => `${cache}:${result}`,
    );

  beforeEach(async () => {
    cmsRedisService = { get: jest.fn().mockResolvedValue(null) };
    cacheManager = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    };
    metricsMock = createMetricsServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantConfigService,
        { provide: CmsRedisService, useValue: cmsRedisService },
        { provide: CACHE_MANAGER, useValue: cacheManager },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: MetricsService, useValue: metricsMock },
      ],
    }).compile();

    service = module.get<TenantConfigService>(TenantConfigService);
  });

  it('getSearchConfig: redis hit populates the LRU; second call is an lru hit only', async () => {
    cmsRedisService.get.mockResolvedValue(JSON.stringify({ mode: 'default' }));

    await service.getSearchConfig('tenant-1');
    expect(recordCalls()).toEqual([
      'tenant-config-lru:miss',
      'tenant-config-redis:hit',
    ]);

    await service.getSearchConfig('tenant-1');
    expect(recordCalls()).toEqual([
      'tenant-config-lru:miss',
      'tenant-config-redis:hit',
      'tenant-config-lru:hit',
    ]);
  });

  it('getFacets: redis miss is not cached; both calls record lru + redis miss', async () => {
    cmsRedisService.get.mockResolvedValue(null);

    await expect(service.getFacets('tenant-1')).resolves.toEqual([]);
    await expect(service.getFacets('tenant-1')).resolves.toEqual([]);

    expect(recordCalls()).toEqual([
      'tenant-config-lru:miss',
      'tenant-config-redis:miss',
      'tenant-config-lru:miss',
      'tenant-config-redis:miss',
    ]);
  });

  it('getTenantLocales: redis throw records get-error then miss and returns []', async () => {
    cmsRedisService.get.mockRejectedValue(new Error('redis down'));

    await expect(service.getTenantLocales('tenant-1')).resolves.toEqual([]);

    expect(recordCalls()).toEqual([
      'tenant-config-lru:miss',
      'tenant-config-redis:get-error',
      'tenant-config-redis:miss',
    ]);
  });

  it('getKeycloakRealmId: cms redis null falls back to app-redis hit', async () => {
    cmsRedisService.get.mockResolvedValue(null);
    cacheManager.get.mockResolvedValue('realm-x');

    await expect(service.getKeycloakRealmId('tenant-1')).resolves.toBe(
      'realm-x',
    );

    expect(recordCalls()).toEqual([
      'tenant-config-lru:miss',
      'tenant-config-redis:miss',
      'tenant-config-app-redis:hit',
    ]);
  });

  it('getTopics: returns parsed config and caches it in LRU', async () => {
    const topicsConfig = {
      tenantId: 'tenant-1',
      iconSize: 'medium',
      imageBorderRadius: '8px',
      backTexts: { en: 'Back' },
      customHeadings: { en: 'Help' },
      list: [
        {
          name: 'Housing',
          names: { en: 'Housing' },
          subtopics: [],
        },
      ],
    };
    cmsRedisService.get.mockResolvedValue(JSON.stringify(topicsConfig));

    await expect(service.getTopics('tenant-1')).resolves.toEqual(topicsConfig);
    expect(recordCalls()).toEqual([
      'tenant-config-lru:miss',
      'tenant-config-redis:hit',
    ]);

    await expect(service.getTopics('tenant-1')).resolves.toEqual(topicsConfig);
    expect(recordCalls()).toEqual([
      'tenant-config-lru:miss',
      'tenant-config-redis:hit',
      'tenant-config-lru:hit',
    ]);
  });

  it('getTopics: redis miss returns default empty shape', async () => {
    cmsRedisService.get.mockResolvedValue(null);

    await expect(service.getTopics('tenant-1')).resolves.toEqual({
      tenantId: 'tenant-1',
      iconSize: '',
      imageBorderRadius: '',
      backTexts: {},
      customHeadings: {},
      list: [],
    });
  });

  it('getSuggestions: returns parsed config and caches it in LRU', async () => {
    const suggestionsConfig = {
      tenantId: 'tenant-1',
      suggestions: [
        {
          taxonomies: 'BD-1800',
          value: 'Emergency Shelter',
          values: { en: 'Emergency Shelter' },
        },
      ],
    };
    cmsRedisService.get.mockResolvedValue(JSON.stringify(suggestionsConfig));

    await expect(service.getSuggestions('tenant-1')).resolves.toEqual(
      suggestionsConfig,
    );
    expect(recordCalls()).toEqual([
      'tenant-config-lru:miss',
      'tenant-config-redis:hit',
    ]);

    await expect(service.getSuggestions('tenant-1')).resolves.toEqual(
      suggestionsConfig,
    );
    expect(recordCalls()).toEqual([
      'tenant-config-lru:miss',
      'tenant-config-redis:hit',
      'tenant-config-lru:hit',
    ]);
  });

  it('getSuggestions: redis miss returns default empty shape', async () => {
    cmsRedisService.get.mockResolvedValue(null);

    await expect(service.getSuggestions('tenant-1')).resolves.toEqual({
      tenantId: 'tenant-1',
      suggestions: [],
    });
  });

  it('getOrchestrationConfig: returns parsed config and caches it in LRU', async () => {
    const orchestrationConfig = {
      tenantId: 'tenant-1',
      schemas: [],
    };
    cmsRedisService.get.mockResolvedValue(JSON.stringify(orchestrationConfig));

    await expect(service.getOrchestrationConfig('tenant-1')).resolves.toEqual(
      orchestrationConfig,
    );
    expect(recordCalls()).toEqual([
      'tenant-config-lru:miss',
      'tenant-config-redis:hit',
    ]);

    await expect(service.getOrchestrationConfig('tenant-1')).resolves.toEqual(
      orchestrationConfig,
    );
    expect(recordCalls()).toEqual([
      'tenant-config-lru:miss',
      'tenant-config-redis:hit',
      'tenant-config-lru:hit',
    ]);
  });

  it('getOrchestrationConfig: redis miss returns null and caches null', async () => {
    cmsRedisService.get.mockResolvedValue(null);

    await expect(
      service.getOrchestrationConfig('tenant-1'),
    ).resolves.toBeNull();

    // A second call should hit the LRU even though null is cached.
    await expect(
      service.getOrchestrationConfig('tenant-1'),
    ).resolves.toBeNull();
    expect(recordCalls()).toEqual([
      'tenant-config-lru:miss',
      'tenant-config-redis:miss',
      'tenant-config-lru:hit',
    ]);
  });
});
