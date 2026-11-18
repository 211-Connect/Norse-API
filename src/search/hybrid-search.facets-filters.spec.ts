import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { HybridSearchService } from './hybrid-search.service';
import { TenantConfigService } from '../cms-config/tenant-config.service';
import { RequestCacheService } from 'src/common/services/cache/request-cache.service';
import { createMetricsServiceMock } from 'src/metrics/testing/metrics-service.mock';
import { MetricsService } from 'src/metrics/metrics.service';

// ISS-2499: facets, filters and need counts of the v2 search. The filters of
// one request must reach every Elasticsearch request that counts anything:
// the page (or main) request, the fast-path stats request and the need-count
// request. Facet buckets and need counts are then counts of the same set.

const headers = { 'x-tenant-id': 'tenant-a', 'accept-language': 'en' } as any;
const shards = { total: 1, successful: 1, skipped: 0, failed: 0 };
const LIST = ['b', 'a', 'c'];

const facetAggs = {
  languages: { buckets: [{ key: 'Spanish', doc_count: 7 }] },
  label_languages_en: { buckets: [{ key: 'Languages', doc_count: 7 }] },
};

const baseQuery = {
  query: 'food shelf',
  page: 1,
  limit: 3,
  filters: { languages: 'Spanish', age_group: ['a', 'b'] },
  organization_id: 'org-1',
  age: 30,
  distance: 0,
  taxonomy: [] as string[],
} as any;

const expectedClauses = [
  { term: { tenant_id: 'tenant-a' } },
  { term: { 'organization.id': 'org-1' } },
  {
    bool: {
      should: [
        { term: { 'facets.languages.keyword': 'Spanish' } },
        { term: { 'facets_en.languages.keyword': 'Spanish' } },
      ],
      minimum_should_match: 1,
    },
  },
  // Decision 1A: two values of one facet are one clause (OR inside a facet).
  {
    bool: {
      should: [
        { term: { 'facets.age_group.keyword': 'a' } },
        { term: { 'facets_en.age_group.keyword': 'a' } },
        { term: { 'facets.age_group.keyword': 'b' } },
        { term: { 'facets_en.age_group.keyword': 'b' } },
      ],
      minimum_should_match: 1,
    },
  },
];

describe('HybridSearchService facets, filters and need counts (ISS-2499)', () => {
  let service: HybridSearchService;
  let requests: any[];

  const isList = (r: any) => r._source === false && r.size === 100;
  const isStats = (r: any) =>
    r.size === 0 &&
    r.track_total_hits === true &&
    r.aggs?.languages &&
    !r.query?.bool?.filter?.some?.((f: any) => f.ids);
  const isCount = (r: any) => r.size === 0 && r.aggs?.need_counts;
  const isPage = (r: any) =>
    r.query?.bool?.filter?.some?.((f: any) => f.ids) && !isList(r);
  const isMain = (r: any) => r.size === 3 && r.aggs?.languages;

  beforeEach(async () => {
    requests = [];
    const esSearch = jest.fn((req: any) => {
      if (req.index === 'hybrid_taxonomies') {
        return Promise.resolve({ hits: { hits: [] } });
      }
      requests.push(req);
      if (isList(req)) {
        return Promise.resolve({
          hits: { hits: LIST.map((id) => ({ _id: id })) },
        });
      }
      if (isCount(req)) {
        return Promise.resolve({
          aggregations: {
            need_counts: { buckets: [{ key: 'N-FOD', doc_count: 5 }] },
          },
        });
      }
      if (isStats(req)) {
        return Promise.resolve({
          took: 2,
          timed_out: false,
          _shards: shards,
          hits: { total: { value: 7, relation: 'eq' }, hits: [] },
          aggregations: facetAggs,
        });
      }
      if (isPage(req)) {
        return Promise.resolve({
          took: 1,
          timed_out: false,
          _shards: shards,
          hits: {
            hits: [
              ...req.query.bool.filter.find((f: any) => f.ids).ids.values,
            ].map((id: string) => ({
              _index: 'hybrid_search_resources_en',
              _id: id,
              _source: { name: id, facets: {}, facets_en: {} },
            })),
          },
        });
      }
      return Promise.resolve({
        took: 3,
        timed_out: false,
        _shards: shards,
        hits: {
          total: { value: 7, relation: 'eq' },
          hits: [
            {
              _index: 'hybrid_search_resources_en',
              _id: 'a',
              _score: 1,
              sort: [0, 1],
              fields: { matched_needs: ['N-FOD'] },
              _source: { name: 'a', facets: {}, facets_en: {} },
            },
          ],
        },
        aggregations: facetAggs,
      });
    });

    const module = await Test.createTestingModule({
      providers: [
        HybridSearchService,
        {
          provide: ElasticsearchService,
          useValue: { search: esSearch, count: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'EMBEDDING_BASE_URL') return 'https://embed.example';
              if (key === 'EMBEDDING_MODEL') return 'model-x';
              if (key === 'RUNPOD_API_KEY') return 'key';
              return undefined;
            }),
          },
        },
        {
          provide: TenantConfigService,
          useValue: {
            getFacets: jest
              .fn()
              .mockResolvedValue([{ facet: 'languages', name: 'Languages' }]),
            getSearchConfig: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: RequestCacheService,
          useValue: {
            getOrSet: jest.fn((_k: any, f: any) => f()),
            getMany: jest.fn((keys: string[]) =>
              Promise.resolve(keys.map(() => undefined)),
            ),
            setMany: jest.fn().mockResolvedValue(undefined),
            deleteMany: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: MetricsService, useValue: createMetricsServiceMock() },
      ],
    }).compile();
    service = module.get(HybridSearchService);
    jest.spyOn(service, 'embedQuery').mockResolvedValue([0.1, 0.2, 0.3, 0.4]);
  });

  const run = (extra: Record<string, unknown> = {}): Promise<any> =>
    service.searchHybrid({
      headers,
      query: baseQuery,
      rankingVersion: 'v2',
      ...extra,
    } as any);

  const filtersOf = (r: any): any[] => r.query.bool.filter;

  it('fast path: stats, page and count requests carry the same filters, and the stats facets are returned', async () => {
    const res = await run({ countCodes: ['N-FOD', 'N-HOU'] });

    const stats = requests.filter(isStats);
    const count = requests.filter(isCount);
    expect(stats).toHaveLength(1);
    expect(count).toHaveLength(1);
    expect(requests.filter(isPage)).toHaveLength(1);
    expect(requests.filter(isMain)).toHaveLength(0);

    const statsFilters = filtersOf(stats[0]);
    for (const clause of expectedClauses) {
      expect(statsFilters).toContainEqual(clause);
    }
    // age 30: both bounds
    expect(JSON.stringify(statsFilters)).toContain('"minimum_age"');
    expect(JSON.stringify(statsFilters)).toContain('"maximum_age"');
    expect(filtersOf(count[0])).toEqual(statsFilters);
    const pageFilters = filtersOf(requests.find(isPage));
    expect(pageFilters).toEqual(expect.arrayContaining(statsFilters));

    expect(res.search.hits.total.value).toBe(7);
    expect(res.facets).toEqual([
      {
        key: 'languages',
        name: { en: 'Languages', locale: 'Languages' },
        values: [{ en: 'Spanish', locale: 'Spanish', doc_count: 7 }],
      },
    ]);
    expect(res.needCounts).toEqual({ 'N-FOD': 5, 'N-HOU': 0 });
  });

  it('full path (needs sent): the main request carries the same filters and aggs; facets are the same', async () => {
    const res = await run({
      selectedNeeds: ['N-FOD'],
      countCodes: ['N-FOD'],
    });

    expect(requests.filter(isStats)).toHaveLength(0);
    const main = requests.filter(isMain);
    expect(main).toHaveLength(1);
    const mainJson = JSON.stringify(main[0].query);
    for (const clause of expectedClauses) {
      expect(mainJson).toContain(JSON.stringify(clause));
    }
    const countFilters = filtersOf(requests.find(isCount));
    for (const clause of expectedClauses) {
      expect(countFilters).toContainEqual(clause);
    }
    expect(res.facets[0].values).toEqual([
      { en: 'Spanish', locale: 'Spanish', doc_count: 7 },
    ]);
    expect(res.search.hits.hits[0].matched_needs).toEqual(['N-FOD']);
    expect(res.needCounts).toEqual({ 'N-FOD': 5 });
  });

  it('fast path and full path give the same facets and total for the same filters', async () => {
    const fast = await run();
    requests = [];
    const full = await run({ selectedNeeds: ['N-FOD'] });
    expect(full.facets).toEqual(fast.facets);
    expect(full.search.hits.total).toEqual(fast.search.hits.total);
  });

  it('non-v2 hybrid keeps AND: two values of one facet stay two clauses', async () => {
    await run({ rankingVersion: 'v1' });
    // The v1 hybrid request wraps its bool query in function_score.
    const filters: any[] = requests[0].query.function_score.query.bool.filter;
    const ageClauses = filters.filter((f: any) =>
      JSON.stringify(f).includes('facets.age_group.keyword'),
    );
    expect(ageClauses).toHaveLength(2);
  });

  it('no filters: no facet clause, only the tenant term', async () => {
    await run({ countCodes: ['N-FOD'] });
    requests = [];
    await service.searchHybrid({
      headers,
      query: {
        ...baseQuery,
        filters: {},
        organization_id: undefined,
        age: undefined,
      },
      rankingVersion: 'v2',
    } as any);
    expect(filtersOf(requests.find(isStats))).toEqual([
      { term: { tenant_id: 'tenant-a' } },
    ]);
  });
});
