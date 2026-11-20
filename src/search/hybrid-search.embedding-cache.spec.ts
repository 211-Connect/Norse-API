import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { HybridSearchService } from './hybrid-search.service';
import { TenantConfigService } from '../cms-config/tenant-config.service';
import { RequestCacheService } from 'src/common/services/cache/request-cache.service';
import { createMetricsServiceMock } from 'src/metrics/testing/metrics-service.mock';
import { MetricsService } from 'src/metrics/metrics.service';
import { queryEmbeddingCacheKey } from './internal/cache-key/query-embedding-cache-key';

const VECTOR = [0.1, -0.2, 0.30000001, 4.5];

describe('HybridSearchService query embedding cache', () => {
  let store: Map<string, unknown>;
  let sets: Array<[string, unknown, number | undefined]>;
  let fetchMock: jest.Mock;
  const realFetch = global.fetch;

  const apiOk = () =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ data: [{ embedding: VECTOR }] }),
    });

  const build = async (env: Record<string, string> = {}) => {
    const module = await Test.createTestingModule({
      providers: [
        HybridSearchService,
        RequestCacheService,
        { provide: ElasticsearchService, useValue: {} },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              ({
                EMBEDDING_BASE_URL: 'https://embed.example',
                EMBEDDING_MODEL: 'model-x',
                RUNPOD_API_KEY: 'k',
                ...env,
              })[key],
          },
        },
        { provide: TenantConfigService, useValue: {} },
        { provide: MetricsService, useValue: createMetricsServiceMock() },
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: jest.fn((k: string) => Promise.resolve(store.get(k))),
            set: jest.fn((k: string, v: unknown, ttl?: number) => {
              sets.push([k, v, ttl]);
              store.set(k, v);
              return Promise.resolve();
            }),
            mset: jest.fn((list: any[]) => {
              list.forEach((e) => {
                sets.push([e.key, e.value, e.ttl]);
                store.set(e.key, e.value);
              });
              return Promise.resolve();
            }),
          },
        },
      ],
    }).compile();
    return module.get(HybridSearchService);
  };

  const expectClose = (got: number[], want: number[]) => {
    expect(got).toHaveLength(want.length);
    want.forEach((n, i) => expect(got[i]).toBeCloseTo(n, 6));
  };

  beforeEach(() => {
    store = new Map();
    sets = [];
    fetchMock = jest.fn(apiOk);
    global.fetch = fetchMock as any;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  it('miss calls the API once and writes the cache with the 24 h default', async () => {
    const service = await build();
    expectClose(await service.embedQuery('food bank'), VECTOR);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sets).toHaveLength(1);
    expect(sets[0][0]).toBe(queryEmbeddingCacheKey('model-x', 'food bank'));
    expect(typeof sets[0][1]).toBe('string');
    expect(sets[0][2]).toBe(24 * 60 * 60 * 1000);
  });

  it('normalizes the text for the key and for the API request', async () => {
    const service = await build();
    await service.embedQuery('  food   bank\n');
    await service.embedQuery('food bank');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).input).toBe('food bank');
  });

  it('hit makes no API call and returns the same numbers', async () => {
    const service = await build();
    const first = await service.embedQuery('food bank');
    const second = await service.embedQuery('food bank');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expectClose(second, first);
  });

  it('stores no search text in the key or the value', async () => {
    const service = await build();
    await service.embedQuery('very private words');
    const [key, value] = sets[0];
    expect(key).not.toContain('private');
    expect(String(value)).not.toContain('private');
  });

  it('two concurrent calls for the same text make one API call', async () => {
    const service = await build();
    const [a, b] = await Promise.all([
      service.embedQuery('food bank'),
      service.embedQuery('food bank'),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expectClose(a, b);
  });

  it('a failed API call writes nothing and the next call tries again', async () => {
    const service = await build();
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve('x'),
      }),
    );
    await expect(service.embedQuery('food bank')).rejects.toThrow();
    expect(sets).toHaveLength(0);
    expectClose(await service.embedQuery('food bank'), VECTOR);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('EMBEDDING_CACHE_ENABLED=false skips the cache', async () => {
    const service = await build({ EMBEDDING_CACHE_ENABLED: 'false' });
    await service.embedQuery('food bank');
    await service.embedQuery('food bank');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sets).toHaveLength(0);
  });

  it('only the exact string false turns the cache off', async () => {
    const service = await build({ EMBEDDING_CACHE_ENABLED: 'FALSE' });
    await service.embedQuery('food bank');
    expect(sets).toHaveLength(1);
  });

  it('EMBEDDING_CACHE_TTL_MS overrides the TTL; bad values give the default', async () => {
    let service = await build({ EMBEDDING_CACHE_TTL_MS: '5000' });
    await service.embedQuery('a');
    expect(sets[0][2]).toBe(5000);
    for (const bad of ['0', '-5', 'abc', '1.5']) {
      sets = [];
      service = await build({ EMBEDDING_CACHE_TTL_MS: bad });
      await service.embedQuery('b' + bad);
      expect(sets[0][2]).toBe(24 * 60 * 60 * 1000);
    }
  });

  it('a corrupt cached value counts as a miss and is overwritten', async () => {
    const service = await build();
    const key = queryEmbeddingCacheKey('model-x', 'food bank');
    store.set(key, 'garbage!!');
    expectClose(await service.embedQuery('food bank'), VECTOR);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.get(key)).not.toBe('garbage!!');
    expectClose(await service.embedQuery('food bank'), VECTOR);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a Redis read failure does not fail the search', async () => {
    const service = await build();
    const cache = (service as any).requestCacheService.cacheManager;
    cache.get.mockRejectedValueOnce(new Error('redis down'));
    expectClose(await service.embedQuery('food bank'), VECTOR);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
