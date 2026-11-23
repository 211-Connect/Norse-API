import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { HybridSearchService } from './hybrid-search.service';
import { HYBRID_SORT_FIELDS } from './search-utils.service';

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
  | 'ok'
  | 'reject-vector'
  | 'reject-all'
  | 'reject-proximity'
  | 'empty-lists'
  | 'long-lists';

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
    r._source === false &&
    Array.isArray(r.sort) &&
    !r.query?.bool?.should &&
    r.query?.bool?.filter?.some?.((f: any) => f.ids);
  const isList = (r: any) =>
    r._source === false && r.size === 100 && !Array.isArray(r.sort);
  // The filter of the main page request, whatever the sort made of the query.
  const mainFilterOf = (r: any) =>
    r.query.pinned ? r.query.pinned.organic.bool.filter : r.query.bool.filter;
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
        // Nearest first: the reverse of the pool order, d, c, a, b for FUSED.
        const pool: string[] = req.query.bool.filter.find((f: any) => f.ids).ids
          .values;
        return Promise.resolve({
          hits: {
            hits: [...pool].reverse().map((id, i) => ({
              _id: id,
              sort: [1000 * (i + 1)],
            })),
          },
        });
      }
      if (isList(req)) {
        const kind = kindOf(req);
        if (mode === 'reject-all') {
          return Promise.reject(new Error('es down'));
        }
        if (kind === 'vector' && mode === 'reject-vector') {
          return Promise.reject(new Error('es down'));
        }
        if (mode === 'long-lists' && kind !== 'taxonomy') {
          const prefix = kind === 'keyword' ? 'k' : 'v';
          return Promise.resolve(
            hitsOf(
              Array.from({ length: 100 }, (_, i) => `${prefix}${i}`),
              kind === 'keyword' ? 12.5 : 0.61,
            ),
          );
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
      // The main page request: the total is the kept count (ids filter).
      const idsFilter = (
        req.query?.pinned
          ? req.query.pinned.organic.bool?.filter
          : req.query?.bool?.filter
      )?.find?.((f: any) => f.ids);
      if (idsFilter && req.size > 0 && req.track_total_hits === true) {
        return Promise.resolve({
          ...mainResponse,
          hits: {
            ...mainResponse.hits,
            total: { value: idsFilter.ids.values.length, relation: 'eq' },
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
          useValue: {
            search: esSearch,
            count: jest.fn(),
            // No per-tenant hybrid alias: searches read the shared name.
            indices: { existsAlias: jest.fn().mockResolvedValue(false) },
          },
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
    const mainFilter = organic.bool.filter;
    for (const req of sent) {
      expect(req.size).toBe(100);
      expect(req._source).toBe(false);
      const filter = filterOf(req);
      // The main request adds the kept ids to the filters the lists use.
      expect(mainFilter).toEqual([...filter, { ids: { values: FUSED } }]);
    }

    expect(main.query.pinned.ids).toEqual(FUSED);

    // Regression (live check 2026-11-16): taxonomy ties break by cosine.
    const tax = sent.find((r: any) => kindOf(r) === 'taxonomy');
    expect(tax.query.script_score.query.bool.minimum_should_match).toBe(1);
    expect(tax.query.script_score.script.source).toMatch(
      /^_score \+ 0\.001 \* Math\.max\(0, cosineSimilarity\(params\.qv, 'embedding'\)\)$/,
    );
    expect(tax.query.script_score.script.params.qv).toBeDefined();
    expect(Object.keys(organic)).toEqual(['bool']);
    expect(main.size).toBe(25);
    expect(main.track_total_hits).toBe(true);

    expect(response.search.hits.hits.every((h: any) => h._score === null)).toBe(
      true,
    );
    expect(response.search.hits.max_score).toBeNull();
    expect(response.search.hits.total.value).toBe(FUSED.length);
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

  const COORDS_Q = { coords: [-93.1, 44.9], distance: 25 };
  const proximityRequests = () => requests.filter(isProximity);

  it('T1. v2 text + coords + sort relevance: fusion runs, a proximity list is sent, the main request has the ids filter', async () => {
    const response = await run({ ...COORDS_Q, sort: 'relevance' });

    expect(lists()).toHaveLength(3);
    expect(proximityRequests()).toHaveLength(1);
    const prox = proximityRequests()[0];
    // The pool is the kept set; the filters are the list filters.
    expect(prox.query.bool.filter).toContainEqual({ ids: { values: FUSED } });
    expect(prox.size).toBe(FUSED.length);
    const main = mainRequest();
    expect(main.query.pinned.ids).toEqual(['b', 'c', 'a', 'd']);
    expect(mainFilterOf(main)).toContainEqual({
      ids: { values: expect.any(Array) },
    });
    // Membership never changes: the same ids as the relevance fusion.
    expect([...main.query.pinned.ids].sort()).toEqual([...FUSED].sort());
    expect(
      mainFilterOf(main)
        .find((f: any) => f.ids)
        .ids.values.sort(),
    ).toEqual([...FUSED].sort());
    expect(response.search.hits.hits.every((h: any) => h._score === null)).toBe(
      true,
    );
  });

  it('T2. v2 text + region + coords: no proximity request', async () => {
    await run(
      { ...COORDS_Q, sort: 'relevance' },
      {
        area: {
          regionIds: ['r1'],
          match: 'located_or_serving',
          unlocated: 'virtual',
        },
      },
    );

    expect(lists()).toHaveLength(3);
    expect(proximityRequests()).toHaveLength(0);
    expect(mainRequest().query.pinned.ids).toEqual(FUSED);
  });

  it('T3. v2 text + sort distance + coords: fusion runs; ids and map-point filters on the page, count has ids only', async () => {
    const response = await run(
      { ...COORDS_Q, sort: 'distance' },
      { countCodes: ['N-HOU'] },
    );

    expect(lists()).toHaveLength(3);
    expect(proximityRequests()).toHaveLength(0);
    expect(response.judges).toEqual({ keyword_top: 12.5, vector_top: 0.61 });

    const main = mainRequest();
    expect(main.query.pinned).toBeUndefined();
    const filter = main.query.bool.filter;
    expect(filter).toContainEqual({ ids: { values: FUSED } });
    expect(filter).toContainEqual({ exists: { field: 'location.point' } });
    expect(main.sort[0]._geo_distance).toBeDefined();
    // The lists never see the map-point filter.
    const hasPointFilter = { exists: { field: 'location.point' } };
    for (const req of lists()) {
      expect(filterOf(req)).not.toContainEqual(hasPointFilter);
    }

    const count = requests.find((r) => r.aggs?.need_counts);
    expect(count.query.bool.filter).toContainEqual({
      ids: { values: FUSED },
    });
    expect(count.query.bool.filter).not.toContainEqual(hasPointFilter);
  });

  it('T4. v2 text + sort name: fusion runs; the main request sorts by name over the ids filter', async () => {
    await run({ sort: 'name' });

    expect(lists()).toHaveLength(3);
    const main = mainRequest();
    expect(main.query.pinned).toBeUndefined();
    expect(main.query.bool.filter).toContainEqual({ ids: { values: FUSED } });
    expect(main.sort[0]).toEqual({
      [HYBRID_SORT_FIELDS.name]: { order: 'asc' },
    });
  });

  it.each(['organization', 'distance'] as const)(
    'T4b. v2 text + sort %s (no coords): fusion runs',
    async (sort) => {
      await run({ sort });

      expect(lists()).toHaveLength(3);
      expect(proximityRequests()).toHaveLength(0);
    },
  );

  it('T5. 100 kept: the ids filter holds at most 100 ids and the total is the kept count; page 5 sends from=100', async () => {
    mode = 'long-lists';
    await build();
    const response = await run({ page: 5, limit: 25 });

    const main = requests.find((r) => r.size === 25 && r.min_score == null);
    const ids = main.query.pinned.ids;
    expect(ids).toHaveLength(100);
    expect(mainFilterOf(main).find((f: any) => f.ids).ids.values).toEqual(ids);
    expect(main.from).toBe(100);
    expect(main.track_total_hits).toBe(true);
    expect(response.search.hits.total.value).toBe(100);
  });

  it('T5b. page 2 with limit 3 over 4 kept ids: from=3 over the kept set', async () => {
    await run({ page: 2, limit: 3 });
    const main = requests.find((r) => r.size === 3 && r.min_score == null);
    expect(main.from).toBe(3);
    expect(main.query.pinned.ids).toEqual(FUSED);
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

  it('5b. v2 fused with an active need boost, cutoff on: need list sent; every kept doc is pinned, so no scoring clauses', async () => {
    enabled = 'true';
    await build();
    await run({ relevance_cutoff: 'on' }, { needScores: NEEDS });

    expect(lists().map(kindOf)).toContain('need');
    expect(lists()).toHaveLength(4);
    const main = mainRequest();
    expect(main.query.pinned).toBeDefined();
    expect(JSON.stringify(main.query.pinned.organic)).not.toContain(
      'rank_feature',
    );
  });

  it('5c. every list rejects with an active need boost: the top-score request is sent and the organic query keeps the boost', async () => {
    enabled = 'true';
    mode = 'reject-all';
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

  it('6. the vector list fails: keyword and taxonomy still fuse, no judges, a warning', async () => {
    mode = 'reject-vector';
    const warn = jest.spyOn((service as any).logger, 'warn');
    const response = await run();

    const main = mainRequest();
    expect(main.query.pinned.ids).toEqual(['c', 'a', 'b']);
    expect(response.judges).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('vector'));
    expect(response.search.hits.total.value).toBe(3);
  });

  it('6b. no embedding (the vector list failed): keyword and taxonomy fuse, a warning', async () => {
    jest
      .spyOn(service, 'embedQuery')
      .mockRejectedValue(new Error('embed down'));
    const warn = jest.spyOn((service as any).logger, 'warn');
    const response = await run();

    expect(lists().map(kindOf)).toEqual(['keyword']);
    expect(mainRequest().query.pinned.ids).toEqual(KEYWORD);
    expect(response.judges).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('vector'));
  });

  it('6c. every list fails: the summed request (no ids filter, no pinned) and a warning', async () => {
    mode = 'reject-all';
    const warn = jest.spyOn((service as any).logger, 'warn');
    const response = await run();

    const main = mainRequest();
    expect(main.query.pinned).toBeUndefined();
    expect(JSON.stringify(main.query)).not.toContain('"ids"');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('summed'));
    expect(response.judges).toBeUndefined();
    expect(response.search.hits.total.value).toBe(1234);
    expect(response.search.hits.hits[0]._score).toBe(42);
  });

  it('7. the proximity list fails: the relevance order stays and the membership is the kept set', async () => {
    mode = 'reject-proximity';
    const warn = jest.spyOn((service as any).logger, 'warn');
    await run({ ...COORDS_Q, sort: 'relevance' });

    const main = mainRequest();
    expect(main.query.pinned.ids).toEqual(FUSED);
    expect(mainFilterOf(main).find((f: any) => f.ids).ids.values).toEqual(
      FUSED,
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('proximity'));
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

    it('J3. the vector list rejects: no judges', async () => {
      mode = 'reject-vector';
      const response = await run();
      expect(response.judges).toBeUndefined();
    });

    it('J4. v1 has no judges; coords and any sort have them (fusion runs everywhere)', async () => {
      expect((await run({}, { rankingVersion: undefined })).judges).toBe(
        undefined,
      );
      const judges = { keyword_top: 12.5, vector_top: 0.61 };
      expect(
        (await run({ coords: [-93.1, 44.9], distance: 25 })).judges,
      ).toEqual(judges);
      expect((await run({ sort: 'name' })).judges).toEqual(judges);
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

  describe('pins (plan rule 7)', () => {
    const pins = (
      q: Record<string, unknown>,
      extra: Record<string, unknown> = {},
    ) =>
      service.buildPinsRequest({
        headers,
        query: { ...baseQuery, ...q },
        rankingVersion: 'v2',
        ...extra,
      } as any) as Promise<any>;

    it('P1. v2 text: the pins request carries the kept ids filter', async () => {
      const request = await pins({});

      expect(lists()).toHaveLength(3);
      expect(request.query.pinned.ids).toEqual(FUSED);
      expect(mainFilterOf(request)).toContainEqual({ ids: { values: FUSED } });
    });

    it('P2. v2 text with active needs: the need list joins the kept set', async () => {
      enabled = 'true';
      await build();
      await pins({}, { needScores: NEEDS });

      expect(lists().map(kindOf).sort()).toEqual([
        'keyword',
        'need',
        'taxonomy',
        'vector',
      ]);
    });

    it('P3. v2 empty text: unchanged, no lists and no ids filter', async () => {
      const request = await pins({ query: '' });

      expect(lists()).toHaveLength(0);
      expect(request.query.pinned).toBeUndefined();
      expect(JSON.stringify(request.query)).not.toContain('"ids"');
    });

    it('P4. every list fails: pins keep today membership, with a warning', async () => {
      mode = 'reject-all';
      const warn = jest.spyOn((service as any).logger, 'warn');
      const request = await pins({});

      expect(request.query.pinned).toBeUndefined();
      expect(JSON.stringify(request.query)).not.toContain('"ids"');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('summed'));
    });

    it('P5. v1 pins: no lists', async () => {
      await service.buildPinsRequest({
        headers,
        query: { ...baseQuery },
      } as any);
      expect(lists()).toHaveLength(0);
    });
  });

  it('8. v2 with relevance_cutoff on: the lists carry the cutoff ids filter', async () => {
    await run({ relevance_cutoff: 'on' });

    const sent = lists();
    expect(sent).toHaveLength(3);
    const mainFilter = mainRequest().query.pinned.organic.bool.filter;
    const idsFilter = mainFilter.find((f: any) => f.ids);
    expect(idsFilter).toBeDefined();
    for (const req of sent) {
      const filter = filterOf(req);
      // The cutoff ids filter, not the kept ids the main request adds last.
      expect(
        filter.filter((f: any) => f.ids).map((f: any) => f.ids.values),
      ).toHaveLength(1);
      expect(filter.find((f: any) => f.ids).ids.values).not.toEqual(FUSED);
    }
  });

  it('10. empty query, v2: no fusion and no ids filter; distance with coords, name without', async () => {
    await run({
      query: '',
      coords: [-93.1, 44.9],
      distance: 25,
      sort: 'distance',
    });
    const withCoords = mainRequest();
    expect(lists()).toHaveLength(0);
    expect(proximityRequests()).toHaveLength(0);
    expect(withCoords.sort[0]._geo_distance).toBeDefined();
    expect(JSON.stringify(withCoords.query)).not.toContain('"ids"');
    expect(withCoords.query.pinned).toBeUndefined();

    await build();
    await run({ query: '', sort: 'name' });
    const noCoords = mainRequest();
    expect(lists()).toHaveLength(0);
    expect(noCoords.sort[0]).toEqual({
      [HYBRID_SORT_FIELDS.name]: { order: 'asc' },
    });
    expect(JSON.stringify(noCoords.query)).not.toContain('"ids"');
  });

  describe('v2 sort values (Lucas 2026-11-18)', () => {
    const F = HYBRID_SORT_FIELDS;
    const asc = (field: string) => ({ [field]: { order: 'asc' } });
    const COORDS = [-76.6122, 39.2904];
    const geoTier = {
      _geo_distance: {
        'location.point': { lon: COORDS[0], lat: COORDS[1] },
        order: 'asc',
        unit: 'm',
        mode: 'min',
      },
    };

    beforeEach(async () => {
      searchConfig = { pinned_resources_mode: 'ignore' };
      await build();
    });

    it('relevance, no coords: _score then id; the fused path runs', async () => {
      await run({ sort: 'relevance' });

      expect(lists()).toHaveLength(3);
      expect(mainRequest().query.pinned).toBeDefined();
      expect(mainRequest().sort).toEqual(['_score', asc(F.id)]);
    });

    it('distance with coords: _geo_distance tier then id; the kept set is re-ordered by distance', async () => {
      await run({ sort: 'distance', coords: COORDS });

      expect(lists()).toHaveLength(3);
      expect(mainRequest().query.pinned).toBeUndefined();
      expect(mainRequest().sort).toEqual([geoTier, asc(F.id)]);
    });

    it('distance with no coords: the fused order, _score then id (ISS-1367)', async () => {
      await run({ sort: 'distance' });

      expect(lists()).toHaveLength(3);
      expect(mainRequest().query.pinned.ids).toEqual(FUSED);
      expect(mainRequest().sort).toEqual(['_score', asc(F.id)]);
    });

    it('name: ascending on the hybrid name field then id over the kept set', async () => {
      await run({ sort: 'name' });

      expect(lists()).toHaveLength(3);
      expect(mainRequest().sort).toEqual([asc(F.name), asc(F.id)]);
    });

    it('organization: ascending on organization name, then name, then id over the kept set', async () => {
      await run({ sort: 'organization' });

      expect(lists()).toHaveLength(3);
      expect(mainRequest().sort).toEqual([
        asc(F.organizationName),
        asc(F.name),
        asc(F.id),
      ]);
    });
  });
  // v1 must build the same request as origin/development (plan test 9). The
  // fixtures were recorded from the code before the simple location model.
  describe('9. v1 request is unchanged by the simple location model', () => {
    const cases = [
      ['relevance', { coords: [-93.1, 44.9], distance: 25, sort: 'relevance' }],
      ['distance', { coords: [-93.1, 44.9], distance: 25, sort: 'distance' }],
      ['no-coords', { sort: 'relevance' }],
    ] as const;
    it.each(cases)('v1 text + %s', async (name, q) => {
      await run({ ...q }, { rankingVersion: undefined });
      const file = join(
        __dirname,
        '__fixtures__',
        `v1-hybrid-request-${name}.json`,
      );
      const actual = JSON.parse(JSON.stringify(mainRequest()));
      if (process.env.RECORD_V1_FIXTURE === '1') {
        writeFileSync(file, JSON.stringify(actual, null, 2) + '\n');
      }
      expect(lists()).toHaveLength(0);
      expect(actual).toEqual(JSON.parse(readFileSync(file, 'utf8')));
    });
  });
});
