import { ElasticsearchService } from '@nestjs/elasticsearch';
import { RequestCacheService } from 'src/common/services/cache/request-cache.service';
import { MetricsService } from 'src/metrics/metrics.service';
import { TIER1_CODES } from '../rules/sune';
import { TopAreasService } from './top-areas.service';

const TENANT = '11111111-1111-4111-8111-111111111111';

const metrics = {
  observeDownstream: (_dep: string, _op: string, fn: () => Promise<unknown>) =>
    fn(),
} as unknown as MetricsService;

function build(
  search: jest.Mock,
  existsAlias: jest.Mock = jest.fn().mockResolvedValue(false),
) {
  const getOrSet = jest.fn((_key: string, factory: () => Promise<unknown>) =>
    factory(),
  );
  const service = new TopAreasService(
    { search, indices: { existsAlias } } as unknown as ElasticsearchService,
    { getOrSet } as unknown as RequestCacheService,
    metrics,
  );
  return { service, getOrSet };
}

const buckets = (...b: [string, number][]) =>
  jest.fn().mockResolvedValue({
    aggregations: {
      top_areas: { buckets: b.map(([key, doc_count]) => ({ key, doc_count })) },
    },
  });

describe('TopAreasService', () => {
  it('returns Tier 1 codes in bucket order', async () => {
    const { service } = build(
      buckets(['N-FOD', 9], ['N-HOU', 4], ['N-MON', 1]),
    );
    await expect(service.topAreas(TENANT, 'en')).resolves.toEqual([
      'N-FOD',
      'N-HOU',
      'N-MON',
    ]);
  });

  it('drops non-Tier-1 and zero-count buckets', async () => {
    const { service } = build(
      buckets(['N-ZZZ-NOT-T1', 50], ['N-FOD', 9], ['N-HOU', 0]),
    );
    await expect(service.topAreas(TENANT, 'en')).resolves.toEqual(['N-FOD']);
  });

  it('asks ES for the tenant, the Tier 1 terms agg and a timeout', async () => {
    const search = buckets(['N-FOD', 1]);
    const { service } = build(search);
    await service.topAreas(TENANT, 'es');
    const [request, options] = search.mock.calls[0];
    expect(request.index).toBe('hybrid_search_resources_es');
    expect(request.size).toBe(0);
    expect(request.track_total_hits).toBe(false);
    expect(request.query).toEqual({
      bool: { filter: [{ term: { tenant_id: TENANT } }] },
    });
    expect(request.aggs.top_areas.terms).toEqual({
      field: 'sune_needs',
      include: TIER1_CODES,
      size: TIER1_CODES.length,
    });
    expect(options).toEqual({ requestTimeout: 1500 });
  });

  // Dagster republishes a tenant by pointing this alias at a complete temp
  // copy while it rewrites the shared index. Counting the shared index then
  // would cache a half-published tenant's areas for 24 h.
  it('reads the tenant alias when it exists', async () => {
    const search = buckets(['N-FOD', 1]);
    const existsAlias = jest.fn().mockResolvedValue(true);
    const { service } = build(search, existsAlias);
    await service.topAreas(TENANT, 'es');
    expect(existsAlias).toHaveBeenCalledWith({
      name: `${TENANT}-hybrid_search_resources_es`,
    });
    expect(search.mock.calls[0][0].index).toBe(
      `${TENANT}-hybrid_search_resources_es`,
    );
  });

  it('serves cached areas without checking the alias', async () => {
    const search = jest.fn();
    const existsAlias = jest.fn();
    const service = new TopAreasService(
      { search, indices: { existsAlias } } as unknown as ElasticsearchService,
      {
        getOrSet: jest.fn().mockResolvedValue(['N-FOD']),
      } as unknown as RequestCacheService,
      metrics,
    );
    await expect(service.topAreas(TENANT, 'en')).resolves.toEqual(['N-FOD']);
    expect(existsAlias).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });

  it('reads the shared index when the alias check fails', async () => {
    const search = buckets(['N-FOD', 3]);
    const existsAlias = jest
      .fn()
      .mockRejectedValue(new Error('security_exception'));
    const { service } = build(search, existsAlias);
    await expect(service.topAreas(TENANT, 'en')).resolves.toEqual(['N-FOD']);
    expect(search.mock.calls[0][0].index).toBe('hybrid_search_resources_en');
  });

  it('uses the en index when accept-language is missing', async () => {
    const search = buckets();
    const { service } = build(search);
    await service.topAreas(TENANT, undefined);
    expect(search.mock.calls[0][0].index).toBe('hybrid_search_resources_en');
  });

  it('caches 24 h under a key with tenant and language', async () => {
    const { service, getOrSet } = build(buckets());
    await service.topAreas(TENANT, 'es');
    expect(getOrSet).toHaveBeenCalledWith(
      `topareas:v1:${TENANT}:es`,
      expect.any(Function),
      24 * 60 * 60 * 1000,
    );
  });

  it('returns [] when ES fails, and the factory itself throws (not cached)', async () => {
    const search = jest.fn().mockRejectedValue(new Error('boom'));
    const { service, getOrSet } = build(search);
    await expect(service.topAreas(TENANT, 'en')).resolves.toEqual([]);
    const factory = getOrSet.mock.calls[0][1] as () => Promise<unknown>;
    await expect(factory()).rejects.toThrow('boom');
  });

  it('returns [] when the cache itself fails', async () => {
    const service = new TopAreasService(
      { search: jest.fn() } as unknown as ElasticsearchService,
      {
        getOrSet: jest.fn().mockRejectedValue(new Error('redis down')),
      } as unknown as RequestCacheService,
      metrics,
    );
    await expect(service.topAreas(TENANT, 'en')).resolves.toEqual([]);
  });

  it('caches an empty success as []', async () => {
    const { service } = build(buckets());
    await expect(service.topAreas(TENANT, 'en')).resolves.toEqual([]);
  });
});
