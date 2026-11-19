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
        // A pinned query sorts by its ~1.7e38 score (ISS-2766).
        sort: [1.7e38, 7],
        _source: { name: 'Shelter', facets: {}, facets_en: {} },
      },
    ],
  },
  aggregations: {},
};

type Mode =
  'ok' | 'reject-vector' | 'reject-page' | 'empty-lists' | 'reject-proximity';

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
// Proximity hits as Elasticsearch returns them: distance ascending, in meters.
// b has no point. d and c tie; the service breaks the tie by FUSED order.
const PROXIMITY_HITS = [
  { id: 'd', meters: 100 },
  { id: 'c', meters: 100 },
  { id: 'a', meters: 5000 },
];

describe('HybridSearchService — rank fusion (ISS-2766)', () => {
  let service: HybridSearchService;
  let requests: any[];
  let mode: Mode;
  let enabled: string | undefined;
  let taxonomyGate: Promise<void> | undefined;
  let searchConfig: Record<string, unknown>;
  let proximity: { id: string; meters: number }[];

  // The first hit of the keyword list scores 12.5, of the vector list 0.61
  // (the weak-match judges, ISS-2796).
  const hitsOf = (ids: string[], top?: number) => ({
    hits: {
      hits: ids.map((id, i) => ({
        _id: id,
        ...(i === 0 && top !== undefined && { _score: top }),
      })),
    },
  });
  const isProximity = (r: any) =>
    r._source === false && r.sort?.[0]?._geo_distance !== undefined;
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

      if (isProximity(req)) {
        if (mode === 'reject-proximity') {
          return Promise.reject(new Error('proximity down'));
        }
        return Promise.resolve({
          hits: {
            hits: proximity.map((p) => ({ _id: p.id, sort: [p.meters] })),
          },
        });
      }
      if (isList(req)) {
        const kind = kindOf(req);
        if (kind === 'vector' && mode === 'reject-vector') {
          return Promise.reject(new Error('es down'));
        }
        if (
          mode === 'empty-lists' &&
          (kind === 'keyword' || kind === 'vector')
        ) {
          return Promise.resolve(hitsOf([]));
        }
        return Promise.resolve(
          kind === 'keyword'
            ? hitsOf(KEYWORD, 12.5)
            : kind === 'vector'
              ? hitsOf(VECTOR, 0.61)
              : hitsOf(kind === 'need' ? NEED : TAXONOMY),
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
  const proximityRequests = () => requests.filter(isProximity);
  // The fused order the search used: the pinned ids, or the fast-path page.
  const pinnedIdsOf = () =>
    requests.find((r) => r.query?.pinned)?.query.pinned.ids;
  const COORDS = [-93.1, 44.9];
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
    proximity = PROXIMITY_HITS;
    enabled = 'false';
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
    expect(proximityRequests()).toHaveLength(0);

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

  // `_score` is nulled on a fused search because the pinned score means
  // nothing to a caller; `sort` carries the same number, and fast-path pages
  // return none, so pages of one search differed (David, PR #279 review).
  it('2b. fused hits carry no sort; v1 hits keep theirs', async () => {
    const fused: any = await run({});
    expect(mainRequest().query.pinned).toBeDefined();
    expect(fused.search.hits.hits[0]._score).toBeNull();
    expect(fused.search.hits.hits[0]).not.toHaveProperty('sort');

    await build();
    const v1: any = await run({}, { rankingVersion: undefined });
    expect(v1.search.hits.hits[0].sort).toEqual([1.7e38, 7]);
  });

  it('3. v2 sort relevance with coords: fuses the relevance lists, sends no proximity request', async () => {
    await run({ coords: COORDS, distance: 25 });

    expect(lists().map(kindOf).sort()).toEqual([
      'keyword',
      'taxonomy',
      'vector',
    ]);
    expect(proximityRequests()).toHaveLength(0);
    expect(pinnedIdsOf()).toEqual(FUSED);
  });

  it('3a. v2 sort distance with coords: one proximity request over the pool', async () => {
    proximity = []; // the order is checked in 3b
    await build();
    await run({ coords: COORDS, distance: 25, sort: 'distance' });

    expect(lists()).toHaveLength(3);
    const sent = proximityRequests();
    expect(sent).toHaveLength(1);
    const prox = sent[0];
    const baseFilter = filterOf(lists()[0]);
    for (const f of baseFilter)
      expect(prox.query.bool.filter).toContainEqual(f);
    expect(prox.query.bool.filter).toContainEqual({ ids: { values: FUSED } });
    // Virtual services stay in the pool: no point filter.
    expect(prox.query.bool.filter).not.toContainEqual({
      exists: { field: 'location.point' },
    });
    expect(prox.size).toBe(FUSED.length);
    expect(prox.sort[0]._geo_distance['location.point']).toEqual({
      lon: -93.1,
      lat: 44.9,
    });
    expect(prox.sort[0]._geo_distance.order).toBe('asc');
  });

  // Hand-worked RRF (k = 60), proximity list weight 2. Distances: d 100 m,
  // c 100 m, a 5000 m, b no point (scale 5 mi = 8046 m, after a). The d/c tie
  // goes to pool order (FUSED is b, a, c, d), so the proximity list is
  // [c, d, a, b].
  //   b = 1/62 + 1/61 + 2/64          = 0.064...
  //   a = 1/61 + 1/63 + 2/62          = 0.064...
  //   c = 1/63 + 1/61 + 2/61          = 0.065053
  //   d = 1/62 + 2/62                 = 0.048387
  it('3b. sort distance: the proximity list moves a close weaker doc up and the main request is pinned and not geo sorted', async () => {
    await run({ coords: COORDS, distance: 25, sort: 'distance' });

    const ids = pinnedIdsOf();
    expect(ids).not.toEqual(FUSED);
    expect(ids.indexOf('c')).toBeLessThan(ids.indexOf('b'));
    expect(ids[0]).toBe('c');

    // The pinned query's fused order holds: no geo sort overrides it.
    const main = requests.find((r) => r.query?.pinned);
    expect(JSON.stringify(main.sort ?? [])).not.toContain('_geo_distance');
    expect(main.sort[0]).toBe('_score');
  });

  it('3b2. sort distance fast path: page by id in the fused order, no pinned request', async () => {
    const response = await run({
      coords: COORDS,
      distance: 25,
      sort: 'distance',
      limit: 3,
    });

    expect(requests.some((r) => r.query?.pinned)).toBe(false);
    const page = requests.find(
      (r) =>
        !isList(r) &&
        !isProximity(r) &&
        r.min_score == null &&
        r.query?.bool?.filter?.some?.((f: any) => f.ids),
    );
    expect(page.query.bool.filter.find((f: any) => f.ids).ids.values).toEqual([
      'c',
      'a',
      'd',
    ]);
    expect(response.search.hits.hits.map((h: any) => h._id)).toEqual([
      'c',
      'a',
      'd',
    ]);
  });

  // Lists: a at 3 mi (4828 m), c at 7 mi (11265 m), b with no point, d absent.
  // Scale 5 mi puts b between a and c; scale 10 mi puts b after c.
  //   5 mi : proximity [a, b, c] -> a 0.065053, b 0.064780, c 0.064012, d
  //   10 mi: proximity [a, c, b] -> a 0.065053, c 0.064524, b 0.064268, d
  it.each([
    ['default scale 5 mi', 0, ['a', 'b', 'c', 'd']],
    ['distance 10 mi', 10, ['a', 'c', 'b', 'd']],
  ])(
    '3c. a service with no point ranks as if at the scale distance: %s',
    async (_label, distance, expected) => {
      proximity = [
        { id: 'a', meters: 4828 },
        { id: 'b', meters: Infinity },
        { id: 'c', meters: 11265 },
      ];
      await build();
      await run({ coords: COORDS, distance, sort: 'distance' });

      expect(pinnedIdsOf()).toEqual(expected);
    },
  );

  it('3c2. proximity returns no hits under sort distance: no fusion, plain distance sort', async () => {
    proximity = [];
    await build();
    await run({ coords: COORDS, distance: 25, sort: 'distance' });

    expect(proximityRequests()).toHaveLength(1);
    expect(requests.some((r) => r.query?.pinned)).toBe(false);
    expect(JSON.stringify(mainRequest().sort)).toContain('_geo_distance');
  });

  it('3d. proximity request rejects under sort distance: no fusion and the main request keeps the _geo_distance sort', async () => {
    mode = 'reject-proximity';
    const response = await run({
      coords: COORDS,
      distance: 25,
      sort: 'distance',
    });

    expect(requests.some((r) => r.query?.pinned)).toBe(false);
    expect(mainRequest().query.pinned).toBeUndefined();
    expect(JSON.stringify(mainRequest().sort)).toContain('_geo_distance');
    expect(response.search.hits.total.value).toBe(1234);
    expect(response.search.hits.hits[0]._score).toBe(42);
  });

  it('3e. v2 sort distance without coords: no fusion', async () => {
    await run({ sort: 'distance' });

    expect(lists()).toHaveLength(0);
    expect(proximityRequests()).toHaveLength(0);
    expect(mainRequest().query.pinned).toBeUndefined();
  });

  it('3f. v2 sort name with coords: no fusion', async () => {
    await run({ coords: COORDS, distance: 25, sort: 'name' });

    expect(lists()).toHaveLength(0);
    expect(proximityRequests()).toHaveLength(0);
    expect(mainRequest().query.pinned).toBeUndefined();
  });

  it('3g. v1 sort distance with coords: unchanged, no list requests', async () => {
    await run(
      { coords: COORDS, distance: 25, sort: 'distance' },
      { rankingVersion: undefined },
    );

    expect(lists()).toHaveLength(0);
    expect(proximityRequests()).toHaveLength(0);
    expect(mainRequest().query.pinned).toBeUndefined();
  });

  it('3h. sort distance with relevance_cutoff on: the proximity request carries the cutoff ids filter', async () => {
    await run({
      coords: COORDS,
      distance: 25,
      sort: 'distance',
      relevance_cutoff: 'on',
    });

    const prox = proximityRequests();
    expect(prox).toHaveLength(1);
    const idsFilter = prox[0].query.bool.filter.filter((f: any) => f.ids);
    // The cutoff's ids filter and the pool's ids filter.
    expect(idsFilter).toHaveLength(2);
    const mainFilter =
      mainRequest().query.pinned.organic.function_score.query.bool.filter;
    expect(prox[0].query.bool.filter).toContainEqual(
      mainFilter.find((f: any) => f.ids),
    );
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

  describe('weak-match judges and needFilter (ISS-2796, Lucas 2026-11-18)', () => {
    it('J1. fused search returns the top raw score of the keyword and vector lists', async () => {
      const response = await run();
      expect(response.judges).toEqual({ keyword_top: 12.5, vector_top: 0.61 });
    });

    it('J2. lists with no hits: both judges are 0', async () => {
      mode = 'empty-lists';
      const response = await run();
      expect(response.judges).toEqual({ keyword_top: 0, vector_top: 0 });
    });

    it('J3. a list rejects: no judges', async () => {
      mode = 'reject-vector';
      const response = await run();
      expect(response.judges).toBeUndefined();
    });

    it('J4. non-fused paths (v1, sort name): no judges', async () => {
      expect((await run({}, { rankingVersion: undefined })).judges).toBe(
        undefined,
      );
      expect((await run({ sort: 'name' })).judges).toBe(undefined);
    });

    it('J5. sort relevance with coords fuses, so the judges are known (weak match with a location)', async () => {
      const response = await run({ coords: [-93.1, 44.9], distance: 25 });
      expect(response.judges).toEqual({ keyword_top: 12.5, vector_top: 0.61 });
    });

    it('J6. sort distance with coords: the judges are known, also when proximity rejects', async () => {
      const coords = {
        coords: [-93.1, 44.9],
        distance: 25,
        sort: 'distance' as const,
      };
      expect((await run(coords)).judges).toEqual({
        keyword_top: 12.5,
        vector_top: 0.61,
      });
      mode = 'reject-proximity';
      expect((await run(coords)).judges).toEqual({
        keyword_top: 12.5,
        vector_top: 0.61,
      });
    });

    const needTerms = { terms: { sune_needs: ['N-HOU', 'N-FOD'] } };
    const tenantTerm = { term: { tenant_id: 'tenant-a' } };

    it('N1. needFilter adds the terms filter right after the tenant filter, in the main and the count request', async () => {
      await run(
        { query: '', relevance_cutoff: 'off' },
        { needFilter: ['N-HOU', 'N-FOD'], countCodes: ['N-HOU', 'N-FOD'] },
      );
      const main = requests.find((r) => r.size === 25 && r.min_score == null);
      const mainFilter =
        main.query.function_score?.query.bool.filter ?? main.query.bool.filter;
      expect(mainFilter.slice(0, 2)).toEqual([tenantTerm, needTerms]);
      const count = requests.find((r) => r.aggs?.need_counts);
      expect(count.query.bool.filter.slice(0, 2)).toEqual([
        tenantTerm,
        needTerms,
      ]);
    });

    it('N2. needFilter is in the keyword and vector lists too', async () => {
      await run({}, { needFilter: ['N-HOU', 'N-FOD'] });
      expect(lists().length).toBeGreaterThan(0);
      for (const req of lists()) {
        expect(filterOf(req).slice(0, 2)).toEqual([tenantTerm, needTerms]);
      }
    });

    it('N3. no needFilter or an empty one: no sune_needs terms filter', async () => {
      await run({}, { needFilter: [] });
      await run();
      for (const req of requests) {
        expect(JSON.stringify(req.query)).not.toContain('"sune_needs"');
      }
    });
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
          !isProximity(r) &&
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

    // The fast path can serve only pages inside the fused RRF_LIST_SIZE (100)
    // ids; past that the stats request was sent and thrown away, running the
    // facet aggregations twice (David, PR #279 review).
    it.each([
      ['page 5 with limit 25', { page: 5, limit: 25 }],
      ['page 1 with limit 150', { page: 1, limit: 150 }],
    ])(
      'F2b. %s reaches past the fused ids: no stats request',
      async (_l, q) => {
        await run(q);
        expect(statsRequests()).toHaveLength(0);
        expect(pinnedMain()).toBeDefined();
      },
    );

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
