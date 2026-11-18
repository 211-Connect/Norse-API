import { ElasticsearchService } from '@nestjs/elasticsearch';
import { RequestCacheService } from 'src/common/services/cache/request-cache.service';
import { TIER1_CODES } from '../rules/sune';
import { TopAreasService } from './top-areas.service';

const TENANT = '11111111-1111-4111-8111-111111111111';

function build(search: jest.Mock) {
  const getOrSet = jest.fn((_key: string, factory: () => Promise<unknown>) =>
    factory(),
  );
  const service = new TopAreasService(
    { search } as unknown as ElasticsearchService,
    { getOrSet } as unknown as RequestCacheService,
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
    );
    await expect(service.topAreas(TENANT, 'en')).resolves.toEqual([]);
  });

  it('caches an empty success as []', async () => {
    const { service } = build(buckets());
    await expect(service.topAreas(TENANT, 'en')).resolves.toEqual([]);
  });
});
