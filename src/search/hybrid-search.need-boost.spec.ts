import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { HybridSearchService } from './hybrid-search.service';
import { TenantConfigService } from '../cms-config/tenant-config.service';
import { RequestCacheService } from 'src/common/services/cache/request-cache.service';
import { createMetricsServiceMock } from 'src/metrics/testing/metrics-service.mock';
import { MetricsService } from 'src/metrics/metrics.service';

const headers = {
  'x-tenant-id': 'tenant-a',
  'accept-language': 'en',
} as any;

const taxonomyResponse = {
  hits: {
    hits: [
      { _id: 't1', _score: 0.9, _source: { code: 'BH-1800', name: 'Housing' } },
    ],
  },
};

const mainResponse = {
  took: 5,
  timed_out: false,
  _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
  hits: {
    total: { value: 1234, relation: 'eq' },
    hits: [
      {
        _index: 'hybrid_search_resources_en',
        _id: 'doc-1',
        _score: 42,
        _source: { name: 'Shelter', facets: {}, facets_en: {} },
      },
    ],
  },
  aggregations: {},
};

// Start values from the service; the tests restate them so a change is visible.
const FRACTION = 0.1;
const TIER1_FACTOR = 0.5;
const TOP_SCORE = 200;

type Needs = { code: string; tier: 'tier1' | 'tier2'; score: number }[];

describe('HybridSearchService — need boost (ISS-2745)', () => {
  let service: HybridSearchService;
  let requests: any[];
  let headMode: 'hit' | 'empty' | 'throw';
  let enabled: string | undefined;

  const build = async () => {
    requests = [];
    const esSearch = jest.fn((req: any) => {
      if (req.index === 'hybrid_taxonomies') {
        return Promise.resolve(taxonomyResponse);
      }
      requests.push(req);

      // cutoff probe: head (size 21), count, survivors
      if (req._source === false && req.size === 21) {
        return Promise.resolve({
          hits: {
            total: { value: 1234, relation: 'eq' },
            hits: Array.from({ length: 21 }, (_, i) => ({
              _id: i === 0 ? 'top' : `rank-${i}`,
              _score: i === 0 ? 100 : 20,
            })),
          },
        });
      }
      if (req.size === 0 && req.min_score != null) {
        return Promise.resolve({
          hits: { total: { value: 18, relation: 'eq' }, hits: [] },
        });
      }
      if (req.min_score != null && Array.isArray(req._source)) {
        return Promise.resolve({
          hits: {
            hits: Array.from({ length: req.size }, (_, i) => ({
              _id: `keep-${i}`,
              _score: req.min_score,
              _source: { service_id: `svc-${i}` },
            })),
          },
        });
      }
      // need-boost top-score head call
      if (req._source === false && req.size === 1) {
        if (headMode === 'throw') return Promise.reject(new Error('es down'));
        if (headMode === 'empty')
          return Promise.resolve({ hits: { hits: [] } });
        return Promise.resolve({
          hits: { hits: [{ _id: 'top', _score: TOP_SCORE }] },
        });
      }
      return Promise.resolve(mainResponse);
    });

    const module: TestingModule = await Test.createTestingModule({
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
              if (key === 'NEED_BOOST_ENABLED') return enabled;
              return undefined;
            }),
          },
        },
        {
          provide: TenantConfigService,
          useValue: {
            getFacets: jest.fn().mockResolvedValue([]),
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
          },
        },
        { provide: MetricsService, useValue: createMetricsServiceMock() },
      ],
    }).compile();

    service = module.get<HybridSearchService>(HybridSearchService);
    jest.spyOn(service, 'embedQuery').mockResolvedValue([0.1, 0.2, 0.3, 0.4]);
  };

  const baseQuery = {
    query: 'food shelf',
    page: 1,
    limit: 25,
    filters: {},
    distance: 0,
    taxonomy: [] as string[],
  } as any;

  const isNeedHead = (r: any) => r._source === false && r.size === 1;
  const headCalls = () => requests.filter(isNeedHead);
  const mainRequest = () =>
    requests.find((r) => r._source !== false && r.min_score == null);
  const shouldOf = (req: any) => {
    const q = req.query;
    return (q.function_score ? q.function_score.query : q).bool.should;
  };
  const rankFeatures = (req: any) =>
    shouldOf(req).filter((c: any) => c.rank_feature);

  const run = async (
    needScores?: Needs,
    queryOverrides: Record<string, unknown> = {},
  ) => {
    const res: any = await service.searchHybrid({
      headers,
      query: { ...baseQuery, ...queryOverrides },
      needScores,
    });
    return res;
  };

  const tier2Fod: Needs = [{ code: 'N-FOD-01', tier: 'tier2', score: 0.98 }];

  beforeEach(async () => {
    enabled = 'true';
    headMode = 'hit';
    await build();
  });

  it('1. switch off: no head call and the request ignores needScores', async () => {
    enabled = undefined;
    await build();
    await run();
    const without = mainRequest();

    await build();
    await run(tier2Fod);

    expect(headCalls()).toHaveLength(0);
    expect(mainRequest()).toEqual(without);
  });

  it('2. switch on, no needScores: no head call, request unchanged', async () => {
    enabled = undefined;
    await build();
    await run();
    const baseline = mainRequest();

    enabled = 'true';
    await build();
    await run();

    expect(headCalls()).toHaveLength(0);
    expect(mainRequest()).toEqual(baseline);
  });

  it('3. only sub-gate scores and N-X: no head call, request unchanged', async () => {
    await run();
    const baseline = mainRequest();

    await build();
    await run([
      { code: 'N-FOD-01', tier: 'tier2', score: 0.96 },
      { code: 'N-X', tier: 'other', score: 0.99 },
      { code: 'N-X', tier: 'tier2', score: 0.99 },
    ] as any);

    expect(headCalls()).toHaveLength(0);
    expect(mainRequest()).toEqual(baseline);
  });

  it('4. active tier2 need: one head call and a rank_feature clause', async () => {
    await run(tier2Fod);

    const heads = headCalls();
    expect(heads).toHaveLength(1);
    expect(heads[0].size).toBe(1);
    expect(heads[0]._source).toBe(false);
    expect(heads[0].track_total_hits).toBe(false);
    expect(heads[0].sort).toEqual(['_score']);
    expect(JSON.stringify(heads[0])).not.toContain('rank_feature');

    const clauses = rankFeatures(mainRequest());
    expect(clauses).toHaveLength(1);
    expect(clauses[0].rank_feature.field).toBe('sune_need_weights.N-FOD-01');
    expect(clauses[0].rank_feature.linear).toEqual({});
    expect(clauses[0].rank_feature.boost).toBeCloseTo(
      FRACTION * TOP_SCORE * 0.98,
      6,
    );
  });

  it('5. tier1 need uses the smaller factor', async () => {
    await run([
      { code: 'N-FOD', tier: 'tier1', score: 0.99 },
      { code: 'N-FOD-01', tier: 'tier2', score: 0.98 },
    ]);

    const byField = Object.fromEntries(
      rankFeatures(mainRequest()).map((c: any) => [
        c.rank_feature.field,
        c.rank_feature.boost,
      ]),
    );
    expect(byField['sune_need_weights.N-FOD']).toBeCloseTo(
      FRACTION * TOP_SCORE * 0.99 * TIER1_FACTOR,
      6,
    );
    expect(byField['sune_need_weights.N-FOD-01']).toBeCloseTo(
      FRACTION * TOP_SCORE * 0.98,
      6,
    );
  });

  it.each(['empty', 'throw'] as const)(
    '6. head call %s: no rank_feature clause and results still return',
    async (mode) => {
      headMode = mode;
      const response: any = await run(tier2Fod);

      expect(headCalls()).toHaveLength(1);
      expect(rankFeatures(mainRequest())).toHaveLength(0);
      expect(response.search.hits.total.value).toBe(1234);
    },
  );

  it('7. head query equals the main query minus the rank_feature clauses', async () => {
    await run(tier2Fod, {
      relevance_cutoff: 'on',
      coords: [-93.1, 44.9],
      distance: 25,
    });

    const main = JSON.parse(JSON.stringify(mainRequest()));
    const fs = main.query.function_score;
    fs.query.bool.should = fs.query.bool.should.filter(
      (c: any) => !c.rank_feature,
    );

    const head = headCalls()[0];
    expect(head.query).toEqual(main.query);
    expect(head.index).toBe(mainRequest().index);
    expect(head.preference).toBe(mainRequest().preference);
    // cutoff ids and geo functions are in both
    expect(JSON.stringify(head.query)).toContain('"ids"');
    expect(JSON.stringify(head.query)).toContain('gauss');
  });

  it('8. pins request with rank false: no head call', async () => {
    await service.buildPinsRequest({
      headers,
      query: baseQuery,
      needScores: tier2Fod,
    } as any);

    expect(headCalls()).toHaveLength(0);
  });
});
