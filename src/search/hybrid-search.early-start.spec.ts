import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { HybridSearchService } from './hybrid-search.service';
import { TenantConfigService } from '../cms-config/tenant-config.service';
import { RequestCacheService } from 'src/common/services/cache/request-cache.service';
import { createMetricsServiceMock } from 'src/metrics/testing/metrics-service.mock';
import { MetricsService } from 'src/metrics/metrics.service';
import { reciprocalRankFusion } from './internal/ranking/rank-fusion';

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

type Mode = 'ok' | 'reject-vector' | 'reject-keyword' | 'reject-page';

// Lists as Elasticsearch would return them. Hand-worked RRF (k = 60):
//   b = 1/62 + 1/61 = 0.032522
//   a = 1/61 + 1/63 = 0.032266
//   c = 1/63 + 1/61 = 0.032266 (ties a; a's best rank is in an earlier list)
//   d = 1/62        = 0.016129
const KEYWORD = ['a', 'b', 'c'];
const VECTOR = ['b', 'd', 'a'];
const TAXONOMY = ['c'];
const NEED = ['n1'];

describe('HybridSearchService — early retrieval start', () => {
  let service: HybridSearchService;
  let requests: any[];
  let mode: Mode;
  let enabled: string | undefined;
  let taxonomyGate: Promise<void> | undefined;
  let rarityGate: Promise<void> | undefined;
  let searchConfig: Record<string, unknown>;
  let facetsImpl: () => Promise<unknown[]>;

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

  const build = async () => {
    requests = [];
    const esSearch = jest.fn((req: any) => {
      if (req.index === 'hybrid_taxonomies') {
        requests.push(req);
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
        if (kind === 'keyword' && mode === 'reject-keyword') {
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
            getFacets: jest.fn(() => facetsImpl()),
            getSearchConfig: jest.fn(() => Promise.resolve(searchConfig)),
          },
        },
        {
          provide: RequestCacheService,
          useValue: {
            getOrSet: jest.fn((_k: any, f: any) => f()),
            getMany: jest.fn((keys: string[]) =>
              (rarityGate ?? Promise.resolve()).then(() =>
                keys.map(() => undefined),
              ),
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

  const options = (extra: Record<string, unknown> = {}) =>
    ({
      headers,
      query: { ...baseQuery },
      rankingVersion: 'v2',
      ...extra,
    }) as any;
  const tick = () => new Promise((r) => setImmediate(r));
  const isStats = (r: any) =>
    r.size === 0 &&
    r.track_total_hits === true &&
    r.aggs &&
    r.query?.bool?.filter;

  beforeEach(async () => {
    mode = 'ok';
    enabled = undefined;
    taxonomyGate = undefined;
    rarityGate = undefined;
    searchConfig = {};
    facetsImpl = () => Promise.resolve([]);
    await build();
  });

  it('sends the lists, the stats request and the taxonomy lookup before searchHybrid runs', async () => {
    service.startEarlyRetrieval(options());
    await tick();

    // The taxonomy list waits for the taxonomy lookup, not for classify. The
    // need list waits for the need scores, which arrive with classify.
    expect(requests.filter(isList).map(kindOf).sort()).toEqual([
      'keyword',
      'taxonomy',
      'vector',
    ]);
    expect(requests.filter(isStats)).toHaveLength(1);
    expect(requests.some((r) => r.index === 'hybrid_taxonomies')).toBe(true);
  });

  it('sends the same Elasticsearch requests with and without the early handle', async () => {
    const without = await service.searchHybrid(options());
    const requestsWithout = [...requests];

    requests.length = 0;
    const opts = options();
    const early = service.startEarlyRetrieval(opts);
    const withEarly = await service.searchHybrid({
      ...opts,
      needScores: [],
      early,
    });

    const key = (r: any) => JSON.stringify(r);
    expect(requests.map(key).sort()).toEqual(requestsWithout.map(key).sort());
    expect(requests.length).toBe(requestsWithout.length);
    expect(withEarly).toEqual(without);
  });

  it('keeps the page and need-list requests identical when needs arrive after the early start', async () => {
    const needScores = [{ code: 'N-01', tier: 'tier1', score: 0.9 }];
    enabled = 'true';
    await build();
    const run = (early: boolean) => {
      requests = [];
      const opts = options({ needScores, selectedNeeds: ['N-01'] });
      return service
        .searchHybrid(
          early ? { ...opts, early: service.startEarlyRetrieval(opts) } : opts,
        )
        .then((res) => ({ res, sent: requests.map((r) => JSON.stringify(r)) }));
    };
    const a = await run(false);
    const b = await run(true);
    expect(b.sent.sort()).toEqual(a.sent.sort());
    expect(b.res).toEqual(a.res);
  });

  describe('each request starts when its own inputs exist', () => {
    const needScores = [
      { code: 'N-FOD-01', tier: 'tier2', score: 0.98 },
      { code: 'N-HOU-01', tier: 'tier1', score: 0.99 },
    ];
    const listKinds = () => requests.filter(isList).map(kindOf);
    const flush = async () => {
      for (let i = 0; i < 5; i++) await tick();
    };
    const hitIds = (res: any) => res.search.hits.hits.map((h: any) => h._id);

    it('keyword list starts before the embedding returns', async () => {
      const baseline = await service.searchHybrid(options());

      requests.length = 0;
      let release!: (v: number[]) => void;
      jest.spyOn(service, 'embedQuery').mockReturnValue(
        new Promise<number[]>((resolve) => {
          release = resolve;
        }),
      );
      const pending = service.searchHybrid(options());
      await flush();

      expect(listKinds()).toEqual(['keyword']);
      const keyword = requests.find(isList);
      expect(keyword.query.bool.minimum_should_match).toBe(1);
      expect(keyword.query.bool.should.length).toBeGreaterThan(0);

      release([0.1, 0.2, 0.3, 0.4]);
      const res = await pending;
      expect(res).toEqual(baseline);
      expect(hitIds(res)).toEqual(hitIds(baseline));
    });

    it('vector list and taxonomy lookup start before word rarity returns', async () => {
      let release!: () => void;
      rarityGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await build();
      const early = service.startEarlyRetrieval(options());
      await flush();

      expect(listKinds().sort()).toEqual(['taxonomy', 'vector']);
      expect(requests.some((r) => r.index === 'hybrid_taxonomies')).toBe(true);
      expect(listKinds()).not.toContain('keyword');

      release();
      await early.stage;
      expect(listKinds().sort()).toEqual(['keyword', 'taxonomy', 'vector']);
    });

    it('taxonomy list starts before classify, and searchHybrid sends only the need list', async () => {
      enabled = 'true';
      await build();
      const opts = options();
      const searchHybrid = jest.spyOn(service, 'searchHybrid');
      const early = service.startEarlyRetrieval(opts);
      await flush();

      expect(searchHybrid).not.toHaveBeenCalled();
      expect(listKinds().sort()).toEqual(['keyword', 'taxonomy', 'vector']);
      const tax = requests.find((r) => isList(r) && kindOf(r) === 'taxonomy');
      expect(tax.query.script_score.query.bool.should.length).toBeGreaterThan(
        0,
      );

      const before = requests.length;
      await service.searchHybrid({ ...opts, needScores, early });
      const after = requests.slice(before).filter(isList).map(kindOf);
      expect(after).toEqual(['need']);
    });

    describe('embedding fails after a speculative keyword list', () => {
      let unhandled: unknown[];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      beforeEach(() => {
        unhandled = [];
        process.on('unhandledRejection', onUnhandled);
        jest
          .spyOn(service, 'embedQuery')
          .mockRejectedValue(new Error('embed down'));
      });
      afterEach(() => process.off('unhandledRejection', onUnhandled));

      it('returns the lexical-only result and does not fuse', async () => {
        const res = await service.searchHybrid(options());
        await flush();

        expect(listKinds()).toEqual(['keyword']);
        expect(requests.some((r) => r.index === 'hybrid_taxonomies')).toBe(
          false,
        );
        expect(requests.some((r) => r.query?.pinned)).toBe(false);
        expect(hitIds(res)).toEqual(['doc-1']);
        expect(unhandled).toEqual([]);
      });

      it('a rejected speculative keyword list is no unhandled rejection', async () => {
        mode = 'reject-keyword';
        const res = await service.searchHybrid(options());
        await flush();

        expect(hitIds(res)).toEqual(['doc-1']);
        expect(unhandled).toEqual([]);
      });
    });

    it('same lists, same order: keyword, vector, taxonomy, need', async () => {
      enabled = 'true';
      await build();
      const expected = reciprocalRankFusion(
        [KEYWORD, VECTOR, TAXONOMY, NEED],
        60,
        [1, 1, 1, 1],
      );
      const fusedIds = () =>
        requests.find((r) => r.query?.pinned)?.query.pinned.ids;
      const opts = options({ needScores });
      await service.searchHybrid(opts);
      expect(fusedIds()).toEqual(expected);

      requests.length = 0;
      const early = service.startEarlyRetrieval(opts);
      await service.searchHybrid({ ...opts, early });
      expect(fusedIds()).toEqual(expected);
    });
  });

  describe('failures', () => {
    let unhandled: unknown[];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    beforeEach(() => {
      unhandled = [];
      process.on('unhandledRejection', onUnhandled);
    });
    afterEach(() => process.off('unhandledRejection', onUnhandled));

    it('a rejected early stage is no unhandled rejection and reaches searchHybrid', async () => {
      facetsImpl = () => Promise.reject(new Error('redis down'));
      const opts = options();
      const early = service.startEarlyRetrieval(opts);
      await tick();
      await tick();
      expect(unhandled).toEqual([]);

      await expect(service.searchHybrid({ ...opts, early })).rejects.toThrow(
        'redis down',
      );
      // Same as today without the handle.
      await expect(service.searchHybrid(opts)).rejects.toThrow('redis down');
    });

    it('a rejected early stage that nobody consumes is no unhandled rejection', async () => {
      facetsImpl = () => Promise.reject(new Error('redis down'));
      service.startEarlyRetrieval(options());
      await tick();
      await tick();
      expect(unhandled).toEqual([]);
    });

    it('a failed vector list falls back to the summed ranking, as without the handle', async () => {
      mode = 'reject-vector';
      const without = await service.searchHybrid(options());
      const requestsWithout = requests.map((r) => JSON.stringify(r)).sort();

      requests.length = 0;
      const opts = options();
      const early = service.startEarlyRetrieval(opts);
      const withEarly = await service.searchHybrid({ ...opts, early });
      await tick();

      expect(unhandled).toEqual([]);
      expect(requests.map((r) => JSON.stringify(r)).sort()).toEqual(
        requestsWithout,
      );
      expect(withEarly).toEqual(without);
    });

    it('a query that is too long rejects inside searchHybrid, not at the early start', async () => {
      const opts = options({
        query: { ...baseQuery, query: 'x'.repeat(5000) },
      });
      let early!: ReturnType<typeof service.startEarlyRetrieval>;
      expect(() => (early = service.startEarlyRetrieval(opts))).not.toThrow();
      await expect(service.searchHybrid({ ...opts, early })).rejects.toThrow(
        /at most/,
      );
      expect(unhandled).toEqual([]);
      expect(requests).toHaveLength(0);
    });
  });

  it('v1: no early requests and the same single request as before', async () => {
    const res = await service.searchHybrid(
      options({ rankingVersion: undefined }),
    );
    expect(requests.filter(isList)).toHaveLength(0);
    expect(requests.filter(isStats)).toHaveLength(0);
    expect((res.search.hits.total as { value: number }).value).toBe(1234);
  });
});
