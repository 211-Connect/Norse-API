import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

import { AnalyticsCacheService } from './analytics-cache.service';
import {
  ANALYTICS_CACHE_TTL_CATALOG_MS,
  ANALYTICS_CACHE_TTL_CLOSED_RANGE_MS,
  ANALYTICS_CACHE_TTL_OPEN_RANGE_MS,
  ANALYTICS_CACHE_KEY_BUCKET_MS,
} from '../internal/constants';

describe('AnalyticsCacheService', () => {
  let service: AnalyticsCacheService;
  let cacheManager: { get: jest.Mock; set: jest.Mock };

  const tenantId = 'tenant-1';
  const websiteIds = ['website-1'];

  beforeEach(async () => {
    cacheManager = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsCacheService,
        {
          provide: CACHE_MANAGER,
          useValue: cacheManager,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(
              (_key: string, defaultValue?: unknown) => defaultValue,
            ),
          },
        },
      ],
    }).compile();

    service = module.get<AnalyticsCacheService>(AnalyticsCacheService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('calls the factory on a full miss and populates L1 + Redis', async () => {
    const factory = jest.fn().mockResolvedValue({ value: 'result' });

    const result = await service.getOrSet(
      tenantId,
      'heatmap',
      websiteIds,
      0,
      1_000,
      factory,
    );

    expect(result).toEqual({ value: 'result' });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(cacheManager.set).toHaveBeenCalledTimes(1);
  });

  it('serves subsequent calls from L1 without hitting Redis or the factory', async () => {
    const factory = jest.fn().mockResolvedValue({ value: 'result' });

    await service.getOrSet(tenantId, 'heatmap', websiteIds, 0, 1_000, factory);
    cacheManager.get.mockClear();

    const result = await service.getOrSet(
      tenantId,
      'heatmap',
      websiteIds,
      0,
      1_000,
      factory,
    );

    expect(result).toEqual({ value: 'result' });
    expect(factory).toHaveBeenCalledTimes(1); // not called again
    expect(cacheManager.get).not.toHaveBeenCalled(); // L1 hit short-circuits L2
  });

  it('treats jittered timestamps within the same minute bucket as the same key', async () => {
    const factory = jest.fn().mockResolvedValue({ value: 'result' });
    const bucketStart = 100 * ANALYTICS_CACHE_KEY_BUCKET_MS;

    await service.getOrSet(
      tenantId,
      'heatmap',
      websiteIds,
      bucketStart,
      bucketStart + 50_000,
      factory,
    );

    const result = await service.getOrSet(
      tenantId,
      'heatmap',
      websiteIds,
      bucketStart + 900, // sub-second jitter, same bucket
      bucketStart + 50_900,
      factory,
    );

    expect(result).toEqual({ value: 'result' });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('falls back to Redis (L2) on an L1 miss', async () => {
    cacheManager.get.mockResolvedValueOnce({ value: 'from-redis' });
    const factory = jest.fn();

    const result = await service.getOrSet(
      tenantId,
      'heatmap',
      websiteIds,
      0,
      1_000,
      factory,
    );

    expect(result).toEqual({ value: 'from-redis' });
    expect(factory).not.toHaveBeenCalled();
  });

  it('coalesces concurrent requests for the same key into a single factory call', async () => {
    let resolveFactory: (value: unknown) => void;
    const factory = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveFactory = resolve;
        }),
    );

    const call1 = service.getOrSet(
      tenantId,
      'heatmap',
      websiteIds,
      0,
      1_000,
      factory,
    );
    const call2 = service.getOrSet(
      tenantId,
      'heatmap',
      websiteIds,
      0,
      1_000,
      factory,
    );

    // Let the microtasks around the Redis `get` mock resolve so the factory
    // is actually invoked before we resolve it.
    await Promise.resolve();
    await Promise.resolve();
    resolveFactory!({ value: 'result' });

    const [result1, result2] = await Promise.all([call1, call2]);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(result1).toEqual({ value: 'result' });
    expect(result2).toEqual({ value: 'result' });
  });

  it('does not throw when Redis get fails, and still calls the factory', async () => {
    cacheManager.get.mockRejectedValueOnce(new Error('redis down'));
    const factory = jest.fn().mockResolvedValue({ value: 'result' });

    const result = await service.getOrSet(
      tenantId,
      'heatmap',
      websiteIds,
      0,
      1_000,
      factory,
    );

    expect(result).toEqual({ value: 'result' });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('does not throw when Redis set fails', async () => {
    cacheManager.set.mockRejectedValueOnce(new Error('redis down'));
    const factory = jest.fn().mockResolvedValue({ value: 'result' });

    const result = await service.getOrSet(
      tenantId,
      'heatmap',
      websiteIds,
      0,
      1_000,
      factory,
    );

    expect(result).toEqual({ value: 'result' });
  });

  describe('when the L1 cache is disabled', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AnalyticsCacheService,
          {
            provide: CACHE_MANAGER,
            useValue: cacheManager,
          },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultValue?: unknown) =>
                key === 'analytics.cache.l1Enabled' ? false : defaultValue,
              ),
            },
          },
        ],
      }).compile();

      service = module.get<AnalyticsCacheService>(AnalyticsCacheService);
    });

    it('always falls through to Redis (L2) instead of using an in-process LRU', async () => {
      const factory = jest.fn().mockResolvedValue({ value: 'result' });

      await service.getOrSet(
        tenantId,
        'heatmap',
        websiteIds,
        0,
        1_000,
        factory,
      );
      cacheManager.get.mockResolvedValueOnce({ value: 'result' });

      const result = await service.getOrSet(
        tenantId,
        'heatmap',
        websiteIds,
        0,
        1_000,
        factory,
      );

      expect(result).toEqual({ value: 'result' });
      expect(factory).toHaveBeenCalledTimes(1); // served by Redis, not the factory
      expect(cacheManager.get).toHaveBeenCalledTimes(2); // L1 disabled, always checks Redis
    });
  });

  describe('TTL selection', () => {
    const dayMs = 24 * 60 * 60 * 1_000;
    const closedEndMs = Date.now() - 2 * dayMs; // definitely closed
    const openEndMs = Date.now(); // definitely open (today)

    it('uses the catalog TTL for the event-catalog endpoint', async () => {
      const factory = jest.fn().mockResolvedValue({ value: 'result' });

      await service.getOrSet(
        tenantId,
        'event-catalog',
        websiteIds,
        0,
        closedEndMs,
        factory,
      );

      expect(cacheManager.set).toHaveBeenCalledWith(
        expect.any(String),
        { value: 'result' },
        ANALYTICS_CACHE_TTL_CATALOG_MS,
      );
    });

    it('uses the closed-range TTL when the range ends before today', async () => {
      const factory = jest.fn().mockResolvedValue({ value: 'result' });

      await service.getOrSet(
        tenantId,
        'stats',
        websiteIds,
        0,
        closedEndMs,
        factory,
      );

      expect(cacheManager.set).toHaveBeenCalledWith(
        expect.any(String),
        { value: 'result' },
        ANALYTICS_CACHE_TTL_CLOSED_RANGE_MS,
      );
    });

    it('uses the open-range TTL when the range ends today', async () => {
      const factory = jest.fn().mockResolvedValue({ value: 'result' });

      await service.getOrSet(
        tenantId,
        'stats',
        websiteIds,
        0,
        openEndMs,
        factory,
      );

      expect(cacheManager.set).toHaveBeenCalledWith(
        expect.any(String),
        { value: 'result' },
        ANALYTICS_CACHE_TTL_OPEN_RANGE_MS,
      );
    });
  });
});
