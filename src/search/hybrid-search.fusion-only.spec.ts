import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { HybridSearchService } from './hybrid-search.service';
import { TenantConfigService } from '../cms-config/tenant-config.service';
import { RequestCacheService } from 'src/common/services/cache/request-cache.service';
import { createMetricsServiceMock } from 'src/metrics/testing/metrics-service.mock';
import { MetricsService } from 'src/metrics/metrics.service';

const headers = { 'x-tenant-id': 'tenant-a', 'accept-language': 'en' } as any;
const COORDS = [-93.1, 44.9];

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
    total: { value: 100, relation: 'eq' },
    hits: [
      {
        _index: 'hybrid_search_resources_en',
        _id: 'doc-1',
        _score: 42,
        sort: [1.7e38, 7],
        _source: { name: 'Shelter', facets: {}, facets_en: {} },
      },
    ],
  },
  aggregations: {},
};

// Hand-worked RRF (k = 60), same lists as hybrid-search.rrf.spec.ts.
const KEYWORD = ['a', 'b', 'c'];
const VECTOR = ['b', 'd', 'a'];
const TAXONOMY = ['c'];
const FUSED = ['b', 'a', 'c', 'd'];
// Keyword + taxonomy only: a 1/61, b 1/62, c 1/63 + 1/61.
const KEYWORD_TAXONOMY_FUSED = ['c', 'a', 'b'];
const KEYWORD_ONLY = ['a', 'b', 'c'];
const NEED = ['n1'];

describe('HybridSearchService — v2 fusion only (ISS-2499)', () => {
  let service: HybridSearchService;
  let requests: any[];
  let metrics: ReturnType<typeof createMetricsServiceMock>;
  let rejectKinds: Set<string>;
  let fusionOnlyConfig: string | undefined;
  let searchConfig: Record<string, unknown>;
  let warn: jest.SpyInstance;

  const isList = (r: any) => r._source === false && r.size === 100;
  const kindOf = (r: any) =>
    r.query.script_score
      ? r.query.script_score.query.bool.should
        ? 'taxonomy'
        : 'vector'
      : r.query.bool.should?.[0]?.rank_feature
        ? 'need'
        : 'keyword';
  const statsRequests = () =>
    requests.filter(
      (r) =>
        r.size === 0 && r.track_total_hits === true && r.query?.bool?.filter,
    );
  const lists = () => requests.filter(isList);
  const mainRequest = () => requests.find((r) => r.from !== undefined);
  const pinnedIdsOf = () =>
    requests.find((r) => r.query?.pinned)?.query.pinned.ids;
  const topScoreRequests = () =>
    requests.filter((r) => r._source === false && r.size === 1);
  const idsFilterOf = (r: any) =>
    r.query?.bool?.filter?.find?.((f: any) => f.ids) ??
    r.query?.pinned?.organic?.function_score?.query?.bool?.filter?.find?.(
      (f: any) => f.ids,
    ) ??
    r.query?.function_score?.query?.bool?.filter?.find?.((f: any) => f.ids) ??
    r.query?.bool?.filter?.find?.((f: any) => f.ids);

  const build = async () => {
    requests = [];
    metrics = createMetricsServiceMock();
    const esSearch = jest.fn((req: any) => {
      if (req.index === 'hybrid_taxonomies') {
        return Promise.resolve(taxonomyResponse);
      }
      requests.push(req);
      if (isList(req)) {
        const kind = kindOf(req);
        if (rejectKinds.has(kind)) return Promise.reject(new Error('es down'));
        const ids =
          kind === 'keyword'
            ? KEYWORD
            : kind === 'vector'
              ? VECTOR
              : kind === 'need'
                ? NEED
                : TAXONOMY;
        return Promise.resolve({
          hits: { hits: ids.map((id) => ({ _id: id })) },
        });
      }
      if (req._source === false && req.size === 1) {
        return Promise.resolve({
          hits: { hits: [{ _id: 'top', _score: 200 }] },
        });
      }
      // stats request (size 0, aggs)
      if (req.size === 0 && req.aggs?.need_counts === undefined && req.aggs) {
        return Promise.resolve({
          took: 7,
          timed_out: false,
          _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
          hits: { total: { value: 100, relation: 'eq' }, hits: [] },
          aggregations: {},
        });
      }
      // page by id
      const ids = req.query?.bool?.filter?.filter?.((f: any) => f.ids);
      if (req.from === undefined && req.track_total_hits === false && ids) {
        const last = ids[ids.length - 1].ids.values;
        return Promise.resolve({
          took: 3,
          timed_out: false,
          _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
          hits: {
            hits: last.map((id: string) => ({
              _index: 'hybrid_search_resources_en',
              _id: id,
              _source: { name: id, facets: {}, facets_en: {} },
            })),
          },
        });
      }
      return Promise.resolve(mainResponse);
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
              if (key === 'NEED_BOOST_ENABLED') return 'true';
              if (key === 'V2_FUSION_ONLY') return fusionOnlyConfig;
              return undefined;
            }),
          },
        },
        {
          provide: TenantConfigService,
          useValue: {
            getFacets: jest.fn().mockResolvedValue([]),
            getSearchConfig: jest.fn(() => Promise.resolve(searchConfig)),
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
        { provide: MetricsService, useValue: metrics },
      ],
    }).compile();

    service = module.get(HybridSearchService);
    jest.spyOn(service, 'embedQuery').mockResolvedValue([0.1, 0.2, 0.3, 0.4]);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  };

  const baseQuery = {
    query: 'food shelf',
    page: 1,
    limit: 25,
    filters: {},
    distance: 0,
    taxonomy: [] as string[],
  } as any;

  const run = (
    queryOverrides: Record<string, unknown> = {},
    extra: Record<string, unknown> = {},
  ): Promise<any> =>
    service.searchHybrid({
      headers,
      query: { ...baseQuery, ...queryOverrides },
      rankingVersion: 'v2',
      ...extra,
    } as any);

  const warned = (text: string) =>
    warn.mock.calls.some((c) => String(c[0]).includes(text));

  beforeEach(async () => {
    rejectKinds = new Set();
    fusionOnlyConfig = undefined;
    searchConfig = {};
    await build();
  });

  afterEach(() => jest.restoreAllMocks());

  it('1. empty query with coords: pinned tiers, then geo distance, no lists', async () => {
    await run({ query: '', coords: COORDS, sort: 'relevance' });

    expect(lists()).toHaveLength(0);
    const sort = mainRequest().sort;
    expect(sort[0]).toEqual({ pinned: 'desc' });
    expect(sort[1]).toEqual({ priority: 'desc' });
    expect(sort[2]._geo_distance).toBeDefined();
    expect(sort).not.toContain('_score');
    expect(mainRequest().query.pinned).toBeUndefined();
  });

  it('2. empty query without coords: pinned tiers, then name ascending', async () => {
    await run({ query: '' });

    expect(lists()).toHaveLength(0);
    const sort = mainRequest().sort;
    expect(sort[0]).toEqual({ pinned: 'desc' });
    expect(sort[1]).toEqual({ priority: 'desc' });
    expect(JSON.stringify(sort[2])).toMatch(/name/);
    expect(JSON.stringify(sort[2])).toMatch(/asc/);
    expect(sort).not.toContain('_score');
  });

  it('2b. empty query, pinned mode ignore: no pinned tiers', async () => {
    searchConfig = { pinned_resources_mode: 'ignore' };
    await build();
    await run({ query: '' });

    expect(mainRequest().sort[0]).not.toEqual({ pinned: 'desc' });
  });

  it('2c. empty query, sort name: unchanged by the switch', async () => {
    await run({ query: '', sort: 'name' });
    const on = mainRequest().sort;
    fusionOnlyConfig = 'false';
    await build();
    await run({ query: '', sort: 'name' });

    expect(on).toEqual(mainRequest().sort);
  });

  it('3. one list rejects: the other lists fuse, logged and counted', async () => {
    rejectKinds = new Set(['vector']);
    await run();

    expect(pinnedIdsOf()).toEqual(KEYWORD_TAXONOMY_FUSED);
    expect(
      warned('RRF list vector failed, fusing the other lists: es down'),
    ).toBe(true);
    expect(metrics.recordRankFallback).toHaveBeenCalledWith(
      'list_failed',
      'vector',
    );
    expect(mainRequest().query.pinned).toBeDefined();
    expect(topScoreRequests()).toHaveLength(0);
  });

  it('3b. the need list keeps its weight when another list drops', async () => {
    rejectKinds = new Set(['keyword']);
    await run(
      {},
      { needScores: [{ code: 'N-HOU-01', tier: 'tier1', score: 0.99 }] },
    );

    expect(metrics.recordRankFallback).toHaveBeenCalledWith(
      'list_failed',
      'keyword',
    );
    // vector [b,d,a], taxonomy [c], need [n1] (weight 1): b, c, n1 and d lead.
    const ids = pinnedIdsOf();
    expect(ids).toContain('n1');
    expect(ids).toHaveLength(5);
  });

  it('4. no query vector: keyword list only, counted', async () => {
    await run({}, { queryVector: Promise.resolve(undefined) });

    expect(lists().map(kindOf)).toEqual(['keyword']);
    expect(pinnedIdsOf()).toEqual(KEYWORD_ONLY);
    expect(metrics.recordRankFallback).toHaveBeenCalledWith(
      'embedding_missing',
    );
  });

  it('5. all lists reject: browse order, counted, no need-boost request', async () => {
    rejectKinds = new Set(['keyword', 'vector', 'taxonomy', 'need']);
    await run(
      { coords: COORDS },
      { needScores: [{ code: 'N-HOU-01', tier: 'tier1', score: 0.99 }] },
    );

    const main = mainRequest();
    expect(main.query.pinned).toBeUndefined();
    expect(main.sort[0]).toEqual({ pinned: 'desc' });
    expect(main.sort[2]._geo_distance).toBeDefined();
    expect(warned('RRF all lists failed, using browse order')).toBe(true);
    expect(metrics.recordRankFallback).toHaveBeenCalledWith('all_lists_failed');
    expect(topScoreRequests()).toHaveLength(0);
  });

  it('6. fused ids bound the main and need-count requests', async () => {
    await run(
      {},
      {
        countCodes: ['N-HOU-01'],
        needScores: [{ code: 'N-HOU-01', tier: 'tier1', score: 0.99 }],
      },
    );

    const fused = pinnedIdsOf();
    expect(fused).toBeDefined();
    const expected = { ids: { values: fused } };
    const counts = requests.find((r) => r.aggs?.need_counts);
    expect(counts.query.bool.filter).toContainEqual(expected);
    expect(
      mainRequest().query.pinned.organic.function_score.query.bool.filter,
    ).toContainEqual(expected);
  });

  it('6b. fast path: the stats request starts after fusion with the ids filter', async () => {
    const hundred = Array.from({ length: 100 }, (_, i) => `x${i}`);
    (service as any).fetchFusedOrder = jest.fn().mockResolvedValue(hundred);
    await run();

    const stats = statsRequests();
    expect(stats).toHaveLength(1);
    expect(stats[0].query.bool.filter).toContainEqual({
      ids: { values: hundred },
    });
    // Page by id replaced the full request.
    expect(mainRequest()).toBeUndefined();
  });

  it('6c. page 5 of limit 25 with 100 fused ids asks from 100', async () => {
    const hundred = Array.from({ length: 100 }, (_, i) => `x${i}`);
    const list = jest.fn();
    (service as any).fetchFusedOrder = list.mockResolvedValue(hundred);
    await run({ page: 5 });

    expect(mainRequest().from).toBe(100);
    expect(mainRequest().query.pinned.ids).toEqual(hundred);
    expect(
      mainRequest().query.pinned.organic.function_score.query.bool.filter,
    ).toContainEqual({ ids: { values: hundred } });
  });

  it('7. switch off: a failed list keeps today summed request', async () => {
    fusionOnlyConfig = 'false';
    await build();
    rejectKinds = new Set(['vector']);
    await run();

    const main = mainRequest();
    expect(main.query.pinned).toBeUndefined();
    expect(main.sort).toEqual(['_score', expect.objectContaining({})]);
    expect(metrics.recordRankFallback).not.toHaveBeenCalled();
    expect(idsFilterOf(main)).toBeUndefined();
    expect(warned('RRF lists failed, using summed ranking')).toBe(true);
  });

  it('8. v1 with the switch on: unchanged', async () => {
    rejectKinds = new Set(['vector']);
    await run({}, { rankingVersion: undefined });

    expect(lists()).toHaveLength(0);
    const main = mainRequest();
    expect(main.query.pinned).toBeUndefined();
    expect(idsFilterOf(main)).toBeUndefined();
    expect(metrics.recordRankFallback).not.toHaveBeenCalled();
  });

  it('9. relevance-mode proximity failure counts and keeps the relevance order', async () => {
    (service as any).runProximityList = jest
      .fn()
      .mockRejectedValue(new Error('prox down'));
    await run({ coords: COORDS, distance: 25 });

    expect(pinnedIdsOf()).toEqual(FUSED);
    expect(metrics.recordRankFallback).toHaveBeenCalledWith(
      'list_failed',
      'proximity',
    );
  });

  it('10. distance sort without coords fuses', async () => {
    await run({ sort: 'distance' });

    expect(pinnedIdsOf()).toEqual(FUSED);
  });
});
