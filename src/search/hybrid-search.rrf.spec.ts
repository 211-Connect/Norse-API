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

type Mode = 'ok' | 'reject-vector' | 'reject-page';

// Lists as Elasticsearch would return them. Hand-worked RRF (k = 60):
//   b = 1/62 + 1/61 = 0.032522
//   a = 1/61 + 1/63 = 0.032266
//   c = 1/63 + 1/61 = 0.032266 (ties a; a's best rank is in an earlier list)
//   d = 1/62        = 0.016129
const KEYWORD = ['a', 'b', 'c'];
const VECTOR = ['b', 'd', 'a'];
const TAXONOMY = ['c'];
const FUSED = ['b', 'a', 'c', 'd'];
const NEED = ['n1'];

describe('HybridSearchService — rank fusion (ISS-2766)', () => {
  let service: HybridSearchService;
  let requests: any[];
  let mode: Mode;
  let enabled: string | undefined;
  let taxonomyGate: Promise<void> | undefined;
  let searchConfig: Record<string, unknown>;

  const hitsOf = (ids: string[]) => ({
    hits: { hits: ids.map((id) => ({ _id: id })) },
  });
  const isList = (r: any) => r._source === false && r.size === 100;
  const kindOf = (r: any) =>
    r.query.script_score
      ? r.query.script_score.query.bool.should
        ? 'taxonomy'
        : 'vector'
      : r.query.bool.should?.[0]?.rank_feature
        ? 'need'
        : 'keyword';
  const filterOf = (r: any) =>
    r.query.script_score
      ? r.query.script_score.query.bool.filter
      : r.query.bool.filter;

  const build = async () => {
    requests = [];
    const esSearch = jest.fn((req: any) => {
      if (req.index === 'hybrid_taxonomies') {
        return taxonomyGate
          ? taxonomyGate.then(() => taxonomyResponse)
          : Promise.resolve(taxonomyResponse);
      }
      requests.push(req);

      if (isList(req)) {
        const kind = kindOf(req);
        if (kind === 'vector' && mode === 'reject-vector') {
          return Promise.reject(new Error('es down'));
        }
        return Promise.resolve(
          hitsOf(
            kind === 'keyword'
              ? KEYWORD
              : kind === 'vector'
                ? VECTOR
                : kind === 'need'
                  ? NEED
                  : TAXONOMY,
          ),
        );
      }
      // relevance cutoff probe: head (size 21), count, survivors
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
        return Promise.resolve({
          hits: { hits: [{ _id: 'top', _score: 200 }] },
        });
      }
      // fused page fast path: stats request (totals and facets)
      if (
        req.size === 0 &&
        req.track_total_hits === true &&
        req.aggs &&
        req.query?.bool?.filter &&
        !req.query.bool.filter.some((f: any) => f.ids)
      ) {
        return Promise.resolve({
          took: 7,
          timed_out: false,
          _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
          hits: { total: { value: 1234, relation: 'eq' }, hits: [] },
          aggregations: { stats_agg: { buckets: [] } },
        });
      }
      // fused page fast path: the page by id, returned in reversed order
      const idsFilter = req.query?.bool?.filter?.find?.((f: any) => f.ids);
      if (idsFilter && req.size <= 25 && req.track_total_hits === false) {
        if (mode === 'reject-page') {
          return Promise.reject(new Error('page down'));
        }
        return Promise.resolve({
          took: 3,
          timed_out: false,
          _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
          hits: {
            hits: [...idsFilter.ids.values].reverse().map((id: string) => ({
              _index: 'hybrid_search_resources_en',
              _id: id,
              _source: { name: id, facets: {}, facets_en: {} },
            })),
          },
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

  const lists = () => requests.filter(isList);
  const mainRequest = () =>
    requests.find((r) => r.size === 25 && r.min_score == null);
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

  beforeEach(async () => {
    mode = 'ok';
    enabled = undefined;
    taxonomyGate = undefined;
    searchConfig = {};
    await build();
  });

  it('1. v1: no list requests and no pinned query', async () => {
    await run({}, { rankingVersion: undefined });

    expect(lists()).toHaveLength(0);
    expect(mainRequest().query.pinned).toBeUndefined();
  });

  it('2. v2, no coords, relevance: three lists fused through pinned', async () => {
    const response = await run();

    const sent = lists();
    expect(sent).toHaveLength(3);
    expect(sent.map(kindOf).sort()).toEqual(['keyword', 'taxonomy', 'vector']);

    const main = mainRequest();
    const organic = main.query.pinned.organic;
    const mainFilter = organic.function_score.query.bool.filter;
    for (const req of sent) {
      expect(req.size).toBe(100);
      expect(req._source).toBe(false);
      const filter = filterOf(req);
      expect(filter).toEqual(mainFilter);
    }

    expect(main.query.pinned.ids).toEqual(FUSED);

    // Regression (live check 2026-11-16): taxonomy ties break by cosine.
    const tax = sent.find((r: any) => kindOf(r) === 'taxonomy');
    expect(tax.query.script_score.query.bool.minimum_should_match).toBe(1);
    expect(tax.query.script_score.script.source).toMatch(
      /^_score \+ 0\.001 \* Math\.max\(0, cosineSimilarity\(params\.qv, 'embedding'\)\)$/,
    );
    expect(tax.query.script_score.script.params.qv).toBeDefined();
    expect(organic.function_score.query.bool.minimum_should_match).toBe(0);
    expect(main.size).toBe(25);
    expect(main.track_total_hits).toBe(true);

    expect(response.search.hits.hits.every((h: any) => h._score === null)).toBe(
      true,
    );
    expect(response.search.hits.max_score).toBeNull();
    expect(response.search.hits.total.value).toBe(1234);
  });

  it('3. v2 with coords: no list requests and no pinned query', async () => {
    const response = await run({ coords: [-93.1, 44.9], distance: 25 });

    expect(lists()).toHaveLength(0);
    expect(mainRequest().query.pinned).toBeUndefined();
    expect(response.search.hits.hits[0]._score).toBe(42);
    expect(response.search.hits.max_score).toBe(42);
  });

  it('4. v2 with sort name: no list requests and no pinned query', async () => {
    await run({ sort: 'name' });

    expect(lists()).toHaveLength(0);
    expect(mainRequest().query.pinned).toBeUndefined();
  });

  const NEEDS = [
    { code: 'N-FOD-01', tier: 'tier2', score: 0.98 },
    { code: 'N-HOU-01', tier: 'tier1', score: 0.99 },
  ];
  const isTopScoreHead = (r: any) => r._source === false && r.size === 1;

  it('5. v2 fused with an active need boost, cutoff off: four lists, a need list, no top-score request', async () => {
    enabled = 'true';
    await build();
    await run({}, { needScores: NEEDS });

    const sent = lists();
    expect(sent).toHaveLength(4);
    expect(sent.map(kindOf).sort()).toEqual([
      'keyword',
      'need',
      'taxonomy',
      'vector',
    ]);

    const need = sent.find((r: any) => kindOf(r) === 'need');
    expect(need.query.bool.minimum_should_match).toBe(1);
    const clauses = need.query.bool.should;
    expect(clauses).toHaveLength(2);
    expect(clauses[0].rank_feature.field).toBe('sune_need_weights.N-FOD-01');
    expect(clauses[0].rank_feature.boost).toBeCloseTo(0.98);
    expect(clauses[1].rank_feature.field).toBe('sune_need_weights.N-HOU-01');
    expect(clauses[1].rank_feature.boost).toBeCloseTo(0.495);

    expect(requests.some(isTopScoreHead)).toBe(false);
    const main = mainRequest();
    expect(main.query.pinned).toBeDefined();
    expect(JSON.stringify(main.query.pinned.organic)).not.toContain(
      'rank_feature',
    );
  });

  it('5b. v2 fused with an active need boost, cutoff on: need list sent and the organic query keeps the boost', async () => {
    enabled = 'true';
    await build();
    await run({ relevance_cutoff: 'on' }, { needScores: NEEDS });

    expect(lists().map(kindOf)).toContain('need');
    expect(lists()).toHaveLength(4);
    const main = mainRequest();
    expect(main.query.pinned).toBeDefined();
    expect(JSON.stringify(main.query.pinned.organic)).toContain('rank_feature');
  });

  it('5c. fused planned with an active need boost but one list rejects: the top-score request is sent and the organic query keeps the boost', async () => {
    enabled = 'true';
    mode = 'reject-vector';
    await build();
    await run({}, { needScores: NEEDS });

    expect(requests.some(isTopScoreHead)).toBe(true);
    const main = mainRequest();
    expect(main.query.pinned).toBeUndefined();
    expect(JSON.stringify(main.query)).toContain('rank_feature');
  });

  it('5d. cutoff off: keyword and vector lists are sent before the taxonomy lookup resolves', async () => {
    let release!: () => void;
    taxonomyGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await build();
    const pending = run();

    for (let i = 0; i < 50 && lists().length < 2; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(lists().map(kindOf).sort()).toEqual(['keyword', 'vector']);

    release();
    await pending;
    expect(lists()).toHaveLength(3);
  });

  it('6. v2 with one list rejecting: no pinned query and the search resolves', async () => {
    mode = 'reject-vector';
    const response = await run();

    expect(mainRequest().query.pinned).toBeUndefined();
    expect(response.search.hits.total.value).toBe(1234);
    expect(response.search.hits.hits[0]._score).toBe(42);
  });

  it('7. pins request with v2 and relevance_cutoff on: no list requests and no pinned query', async () => {
    const request: any = await service.buildPinsRequest({
      headers,
      query: { ...baseQuery, relevance_cutoff: 'on' },
      rankingVersion: 'v2',
    } as any);

    expect(lists()).toHaveLength(0);
    expect(request.query.pinned).toBeUndefined();
  });

  it('8. v2 with relevance_cutoff on: the lists carry the cutoff ids filter', async () => {
    await run({ relevance_cutoff: 'on' });

    const sent = lists();
    expect(sent).toHaveLength(3);
    const mainFilter =
      mainRequest().query.pinned.organic.function_score.query.bool.filter;
    const idsFilter = mainFilter.find((f: any) => f.ids);
    expect(idsFilter).toBeDefined();
    for (const req of sent) {
      const filter = filterOf(req);
      expect(filter).toContainEqual(idsFilter);
    }
  });

  describe('fused page fast path', () => {
    const statsRequests = () =>
      requests.filter(
        (r) =>
          r.size === 0 &&
          r.track_total_hits === true &&
          r.aggs &&
          r.query?.bool?.filter &&
          !r.query.bool.filter.some((f: any) => f.ids),
      );
    const pageRequests = () =>
      requests.filter(
        (r) =>
          !isList(r) &&
          r.min_score == null &&
          r.query?.bool?.filter?.some?.((f: any) => f.ids),
      );
    const pinnedMain = () => requests.find((r) => r.query?.pinned);

    it('F1. page 1 inside the fused ids: stats before taxonomy, page by id, no pinned request', async () => {
      let release!: () => void;
      taxonomyGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await build();
      const pending = run({ limit: 3 });

      for (let i = 0; i < 50 && statsRequests().length < 1; i++) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      expect(statsRequests()).toHaveLength(1);
      expect(pageRequests()).toHaveLength(0);

      release();
      const response = await pending;

      expect(pinnedMain()).toBeUndefined();
      expect(pageRequests()).toHaveLength(1);
      const page = pageRequests()[0];
      expect(page.size).toBe(3);
      expect(page.track_total_hits).toBe(false);
      expect(page._source.excludes).toContain('embedding');
      expect(page.query.bool.filter.find((f: any) => f.ids).ids.values).toEqual(
        FUSED.slice(0, 3),
      );
      expect(response.search.hits.hits.map((h: any) => h._id)).toEqual(
        FUSED.slice(0, 3),
      );
      expect(
        response.search.hits.hits.every((h: any) => h._score === null),
      ).toBe(true);
      expect(response.search.hits.max_score).toBeNull();
      expect(response.search.hits.total.value).toBe(1234);
      expect(response.search.took).toBe(7);
      expect(response.facets).toBeDefined();
    });

    it('F2. page 2 with limit 3 over 4 fused ids: pinned main request', async () => {
      const response = await run({ page: 2, limit: 3 });

      expect(pageRequests()).toHaveLength(0);
      expect(pinnedMain().query.pinned.ids).toEqual(FUSED);
      expect(response.search.hits.total.value).toBe(1234);
    });

    it('F3. pinned mode top: pinned main request, no page request', async () => {
      searchConfig = { pinned_resources_mode: 'top' };
      await build();
      await run({ limit: 3 });

      expect(statsRequests()).toHaveLength(0);
      expect(pageRequests()).toHaveLength(0);
      expect(pinnedMain()).toBeDefined();
    });

    it('F4. cutoff on: no stats or page request, pinned main request', async () => {
      await run({ relevance_cutoff: 'on', limit: 3 });

      expect(statsRequests()).toHaveLength(0);
      expect(pageRequests()).toHaveLength(0);
      expect(pinnedMain()).toBeDefined();
    });

    it('F5. page request rejects: warning, pinned main request, search resolves', async () => {
      mode = 'reject-page';
      await build();
      const warn = jest.spyOn((service as any).logger, 'warn');
      const response = await run({ limit: 3 });

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Fused page fast path failed'),
      );
      expect(pinnedMain()).toBeDefined();
      expect(response.search.hits.total.value).toBe(1234);
    });
  });
});
