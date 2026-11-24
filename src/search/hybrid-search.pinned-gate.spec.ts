import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import {
  HybridSearchService,
  NAMED_ORG_PIN_MAX,
  NAMED_PIN_FAILED,
} from './hybrid-search.service';
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

type Mode = 'ok' | 'reject-vector' | 'reject-page';

// Lists as Elasticsearch would return them. Hand-worked RRF (k = 60):
//   b = 1/62 + 1/61 = 0.032522
//   a = 1/61 + 1/63 = 0.032266
//   c = 1/63 + 1/61 = 0.032266 (ties a; a's best rank is in an earlier list)
//   d = 1/62        = 0.016129
const KEYWORD = ['a', 'b', 'c'];
const VECTOR = ['b', 'd', 'a'];
const TAXONOMY = ['c'];
const NEED = ['n1'];

describe('HybridSearchService — v2 pinned gate (Lucas 2026-11-18)', () => {
  let service: HybridSearchService;
  let requests: any[];
  let mode: Mode;
  let gateMode: 'ok' | 'reject';
  let enabled: string | undefined;
  let taxonomyGate: Promise<void> | undefined;
  let searchConfig: Record<string, unknown>;
  let namedOrgServices: string[];

  const hitsOf = (ids: string[]) => ({
    hits: { hits: ids.map((id) => ({ _id: id })) },
  });
  const isList = (r: any) => r._source === false && r.size === 100;
  const isGate = (r: any) => r.size === 0 && r.aggs?.pinned && r.aggs?.other;
  const isNamedOrg = (r: any) =>
    r.query?.bool?.filter?.some?.((f: any) => f.terms?.['organization.id']);
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
        return taxonomyGate
          ? taxonomyGate.then(() => taxonomyResponse)
          : Promise.resolve(taxonomyResponse);
      }
      requests.push(req);
      if (isNamedOrg(req)) {
        return Promise.resolve(hitsOf(namedOrgServices));
      }
      if (isGate(req)) {
        if (gateMode === 'reject')
          return Promise.reject(new Error('gate down'));
        return Promise.resolve({
          hits: { hits: [] },
          aggregations: {
            pinned: {
              top: {
                hits: {
                  hits: [
                    { _id: 'p1', _score: 9 },
                    { _id: 'p2', _score: 3 },
                  ],
                },
              },
            },
            other: { top: { hits: { hits: [{ _id: 'o1', _score: 10 }] } } },
          },
        });
      }

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
    query: 'medicare',
    page: 1,
    limit: 25,
    filters: {},
    distance: 0,
    taxonomy: [] as string[],
  } as any;
  const SEA = [-122.33, 47.61];

  const gates = () => requests.filter(isGate);
  const mainRequest = () =>
    requests.find((r) => r.size === 25 && r.min_score == null);
  const shouldOf = (r: any) =>
    (r.query.function_score?.query ?? r.query).bool.should as any[];
  const pinnedBonus = (r: any) =>
    shouldOf(r).some((c) => c.constant_score?.filter?.term?.pinned === true);
  const priorityFn = (r: any) =>
    JSON.stringify(r.query).includes('field_value_factor');
  const gateTier = (r: any) =>
    shouldOf(r).find((c) => c.constant_score?.filter?.ids);
  const pinnedSortTier = (r: any) =>
    JSON.stringify(r.sort).includes('"pinned"');
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
    gateMode = 'ok';
    enabled = undefined;
    taxonomyGate = undefined;
    namedOrgServices = [];
    searchConfig = { pinned_resources_mode: 'boost' };
    await build();
  });

  it('1. v1 boost: no gate request; +5 pinned bonus and priority function as today', async () => {
    await run({ coords: SEA }, { rankingVersion: undefined });
    expect(gates()).toHaveLength(0);
    const main = mainRequest();
    expect(pinnedBonus(main)).toBe(true);
    expect(priorityFn(main)).toBe(true);
    expect(gateTier(main)).toBeUndefined();
    expect(JSON.stringify(main)).not.toContain('"boost":10000');
  });

  it('2. v1 top: no gate request; sort leads with pinned then priority', async () => {
    searchConfig = { pinned_resources_mode: 'top' };
    await build();
    await run({ coords: SEA }, { rankingVersion: undefined });
    expect(gates()).toHaveLength(0);
    const main = mainRequest();
    expect(main.sort.slice(0, 2)).toEqual([
      { pinned: 'desc' },
      { priority: 'desc' },
    ]);
    expect(JSON.stringify(main)).not.toContain('"boost":10000');
  });

  it('3. v2 boost with coords: one geo-free gate request; only the gated pinned service leads', async () => {
    await run({ coords: SEA });
    expect(gates()).toHaveLength(1);
    const gate = gates()[0];
    expect(JSON.stringify(gate.query)).not.toContain('gauss');
    expect(JSON.stringify(gate.query)).not.toContain('"pinned":true');
    // Fusion runs with coords too: the gated id leads the kept set, and the
    // organic query has no scoring clause (every kept doc is pinned).
    const main = mainRequest();
    expect(main.query.pinned.ids[0]).toBe('p1');
    expect(JSON.stringify(main.query)).not.toContain('"pinned":true');
    expect(priorityFn(main)).toBe(false);
    expect(JSON.stringify(main.query)).not.toContain('10000');
    expect(pinnedSortTier(main)).toBe(false);
  });

  it('4. v2 top with coords: the gate replaces the pinned sort tiers', async () => {
    searchConfig = { pinned_resources_mode: 'top' };
    await build();
    await run({ coords: SEA });
    expect(gates()).toHaveLength(1);
    const main = mainRequest();
    expect(pinnedSortTier(main)).toBe(false);
    expect(JSON.stringify(main.query)).not.toContain('"pinned":true');
    expect(main.query.pinned.ids[0]).toBe('p1');
  });

  it('5. v2 fused (no coords): the gated id goes first in the fused order, once', async () => {
    await run();
    expect(gates()).toHaveLength(1);
    expect(mainRequest().query.pinned.ids).toEqual(['p1', 'b', 'a', 'c', 'd']);
  });

  it('5b. v2 fused, mode top: no pinned sort tier; the gated id leads the fused order', async () => {
    searchConfig = { pinned_resources_mode: 'top' };
    await build();
    await run();
    const main = mainRequest();
    expect(pinnedSortTier(main)).toBe(false);
    expect(main.query.pinned.ids[0]).toBe('p1');
  });

  it('6. v2 ignore: no gate request and no pinned bonus', async () => {
    searchConfig = { pinned_resources_mode: 'ignore' };
    await build();
    await run({ coords: SEA });
    expect(gates()).toHaveLength(0);
    const main = mainRequest();
    expect(JSON.stringify(main.query)).not.toContain('"pinned":true');
    expect(main.query.pinned.ids).not.toContain('p1');
  });

  it('7. v2 browse (empty query): boost and top are one state (care); ignore and an explicit sort drop the tier; v1 is unchanged', async () => {
    const tierSort = [{ pinned: 'desc' }, { priority: 'desc' }];
    const browse = async (
      mode: string,
      extra: Record<string, unknown> = {},
      rankingVersion: string | null = 'v2',
    ) => {
      searchConfig = { pinned_resources_mode: mode };
      await build();
      await run(
        { query: '', coords: SEA, ...extra },
        { rankingVersion: rankingVersion ?? undefined },
      );
      expect(gates()).toHaveLength(0);
      return mainRequest();
    };

    const boost = await browse('boost');
    expect(boost.sort.slice(0, 2)).toEqual(tierSort);
    expect(pinnedBonus(boost)).toBe(false);
    const top = await browse('top');
    expect(top.sort.slice(0, 2)).toEqual(tierSort);
    expect(pinnedBonus(top)).toBe(false);
    expect(top).toEqual(boost);

    const ignore = await browse('ignore');
    expect(pinnedSortTier(ignore)).toBe(false);
    expect(pinnedBonus(ignore)).toBe(false);

    const named = await browse('top', { sort: 'name' });
    expect(pinnedSortTier(named)).toBe(false);
    expect(pinnedBonus(named)).toBe(false);

    const v1 = await browse('boost', {}, null);
    expect(pinnedBonus(v1)).toBe(true);
    expect(pinnedSortTier(v1)).toBe(false);
  });

  it('8. v2 sort name with a query: no gate, no pinned tier, no pinned bonus', async () => {
    searchConfig = { pinned_resources_mode: 'top' };
    await build();
    await run({ sort: 'name', coords: SEA });
    expect(gates()).toHaveLength(0);
    const main = mainRequest();
    expect(pinnedSortTier(main)).toBe(false);
    expect(JSON.stringify(main.query)).not.toContain('"pinned":true');
  });

  it('9. v2 gate request fails: search resolves with no lead and no bonus', async () => {
    gateMode = 'reject';
    await expect(run({ coords: SEA })).resolves.toBeDefined();
    const main = mainRequest();
    expect(main.query.pinned.ids).not.toContain('p1');
    expect(JSON.stringify(main.query)).not.toContain('10000');
  });

  it('10. v2 with relevance_cutoff on: the probe keeps its pinned bonus; the gate sees the cut ids filter', async () => {
    await run({ coords: SEA, relevance_cutoff: 'on' });
    const probe = requests.find((r) => r._source === false && r.size === 21);
    expect(JSON.stringify(probe.query)).toContain('"pinned":true');
    const gateFilter = gates()[0].query.function_score.query.bool
      .filter as any[];
    expect(gateFilter.some((f) => f.ids)).toBe(true);
  });

  describe('named org pin (namedOrgIds, question rule v1)', () => {
    const namedRequests = () => requests.filter(isNamedOrg);

    it("N1. relevance sort: the org's services lead, ones in the fused order first, at most NAMED_ORG_PIN_MAX", async () => {
      searchConfig = {};
      await build();
      // KEYWORD/VECTOR/TAXONOMY fuse to b, a, c, d; the org holds d, x1..x6, a
      namedOrgServices = ['d', 'x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'a'];
      const res = await run({}, { namedOrgIds: ['org-1'] });
      expect(namedRequests()).toHaveLength(1);
      expect(namedRequests()[0].query.bool.filter).toContainEqual({
        terms: { 'organization.id': ['org-1'] },
      });
      const main = mainRequest();
      // a and d are in the fused order (a before d), then the rest in read order
      expect(main.query.pinned.ids.slice(0, NAMED_ORG_PIN_MAX)).toEqual([
        'a',
        'd',
        'x1',
        'x2',
        'x3',
      ]);
      expect(res.namedPinned).toBe(NAMED_ORG_PIN_MAX);
    });

    it('N2. sort=distance and sort=name: no named-org request, plain order', async () => {
      searchConfig = {};
      await build();
      namedOrgServices = ['x1'];
      for (const sort of ['distance', 'name']) {
        await run({ coords: SEA, sort }, { namedOrgIds: ['org-1'] });
      }
      expect(namedRequests()).toHaveLength(0);
    });

    it('N3. no namedOrgIds: no named-org request; v1 (no rankingVersion) ignores them', async () => {
      searchConfig = {};
      await build();
      await run({ coords: SEA });
      await run(
        { coords: SEA },
        { namedOrgIds: ['org-1'], rankingVersion: undefined },
      );
      expect(namedRequests()).toHaveLength(0);
    });

    it('N4. the org has no service in the filters: namedPinned 0, order unchanged', async () => {
      searchConfig = {};
      await build();
      namedOrgServices = [];
      const res = await run({ coords: SEA }, { namedOrgIds: ['org-1'] });
      expect(res.namedPinned).toBe(0);
    });

    it('N5. the named-org request fails: search still returns, nothing pinned, namedPinned is NAMED_PIN_FAILED (not 0)', async () => {
      searchConfig = {};
      await build();
      const es = (service as any).elasticsearchService;
      const orig = es.search;
      es.search = jest.fn((req: any) =>
        isNamedOrg(req) ? Promise.reject(new Error('es down')) : orig(req),
      );
      const res = await run({ coords: SEA }, { namedOrgIds: ['org-1'] });
      expect(res.namedPinned).toBe(NAMED_PIN_FAILED);
    });

    it("N6. with coords the org's services are read nearest first and keep that order (no radius: no far branch leads)", async () => {
      searchConfig = {};
      await build();
      namedOrgServices = ['near', 'mid', 'far'];
      const res = await run({ coords: SEA }, { namedOrgIds: ['org-1'] });
      expect(namedRequests()[0].sort[0]).toHaveProperty('_geo_distance');
      expect(mainRequest().query.pinned.ids.slice(0, 3)).toEqual([
        'near',
        'mid',
        'far',
      ]);
      expect(res.namedPinned).toBe(3);
    });

    it('N7. skipNamedPin: nothing leads, namedPinned still counts what the read found', async () => {
      searchConfig = {};
      await build();
      namedOrgServices = ['near', 'mid', 'far'];
      const res = await run(
        { coords: SEA },
        { namedOrgIds: ['org-1'], skipNamedPin: true },
      );
      expect(mainRequest().query.pinned.ids.slice(0, 3)).not.toEqual([
        'near',
        'mid',
        'far',
      ]);
      expect(res.namedPinned).toBe(3);
    });
  });
});
