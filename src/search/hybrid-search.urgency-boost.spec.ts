import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { HybridSearchService } from './hybrid-search.service';
import { TenantConfigService } from '../cms-config/tenant-config.service';
import { RequestCacheService } from 'src/common/services/cache/request-cache.service';
import { createMetricsServiceMock } from 'src/metrics/testing/metrics-service.mock';
import { MetricsService } from 'src/metrics/metrics.service';

const headers = { 'x-tenant-id': 'tenant-a', 'accept-language': 'en' } as any;

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

type Urgency = { code: any; score: number };
type Needs = { code: string; tier: 'tier1' | 'tier2'; score: number }[];
const tier2Fod: Needs = [{ code: 'N-FOD-01', tier: 'tier2', score: 0.98 }];
// The response excludes name the bare field; a boost names a level after a dot.
const usesUrgency = (requests: unknown) =>
  /sune_urgency_weights\./.test(JSON.stringify(requests));
const u1: Urgency = { code: 'U-1', score: 1 };

describe('HybridSearchService - urgency boost (ISS-2867)', () => {
  let service: HybridSearchService;
  let requests: any[];
  let urgencySwitch: string | undefined;
  let topScore: number;
  let taggedHeadHits: any[];

  const isTopHead = (r: any) => r._source === false && r.size === 1;
  const isList = (r: any) => r._source === false && r.size === 100;
  const isTaggedHead = (r: any) =>
    r.size === 100 && Array.isArray(r._source) && r.min_score == null;
  const isNeedList = (r: any) =>
    isList(r) && r.query.bool?.should?.[0]?.rank_feature;

  const build = async () => {
    requests = [];
    const esSearch = jest.fn((req: any) => {
      if (req.index === 'hybrid_taxonomies') {
        return Promise.resolve(taxonomyResponse);
      }
      requests.push(req);
      if (isList(req)) {
        return Promise.resolve({
          hits: { hits: [{ _id: 'a' }, { _id: 'b' }] },
        });
      }
      if (isTaggedHead(req)) {
        return Promise.resolve({ hits: { hits: taggedHeadHits } });
      }
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
      if (isTopHead(req)) {
        return Promise.resolve({
          hits: { hits: [{ _id: 'top', _score: topScore }] },
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
              if (key === 'URGENCY_BOOST_ENABLED') return urgencySwitch;
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
            deleteMany: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: MetricsService, useValue: createMetricsServiceMock() },
      ],
    }).compile();

    service = module.get<HybridSearchService>(HybridSearchService);
    jest.spyOn(service, 'embedQuery').mockResolvedValue([0.1, 0.2, 0.3, 0.4]);
  };

  // With coords the search is not fused, so the main request carries the boost.
  const geoQuery = {
    query: 'food shelf',
    page: 1,
    limit: 25,
    filters: {},
    distance: 25,
    coords: [-93.1, 44.9],
    taxonomy: [] as string[],
  } as any;
  // No coords and relevance sort: v2 fuses the lists.
  const fusedQuery = { ...geoQuery, distance: 0, coords: undefined };

  const isMain = (r: any) =>
    r._source !== false &&
    r.min_score == null &&
    !isTaggedHead(r) &&
    r.size === 25;
  const mainRequest = () => requests.find(isMain);
  const shouldOf = (req: any) => {
    const q = req.query;
    return (q.function_score ? q.function_score.query : q).bool.should;
  };
  const rankFeatures = (req: any) =>
    shouldOf(req).filter((c: any) => c.rank_feature);

  const run = (
    over: {
      needScores?: Needs;
      urgencyBoost?: Urgency;
      rankingVersion?: 'v2';
      query?: any;
    } = {},
  ) => {
    const { query = geoQuery, rankingVersion = 'v2', ...rest } = over;
    return service.searchHybrid({
      headers,
      query,
      rankingVersion,
      ...rest,
    } as any);
  };

  beforeEach(async () => {
    urgencySwitch = 'true';
    topScore = 200;
    taggedHeadHits = [];
    await build();
  });

  describe('the switch', () => {
    it.each([
      [undefined, false],
      ['false', false],
      ['TRUE ', false],
      ['1', false],
      ['on', false],
      ['', false],
      [' true ', true],
      ['true', true],
    ])('URGENCY_BOOST_ENABLED=%p -> on is %p', async (value, on) => {
      urgencySwitch = undefined;
      await build();
      await run();
      const without = mainRequest();

      urgencySwitch = value;
      await build();
      await run({ urgencyBoost: u1 });

      if (on) {
        expect(usesUrgency(requests)).toBe(true);
        expect(mainRequest()).not.toEqual(without);
      } else {
        expect(usesUrgency(requests)).toBe(false);
        expect(mainRequest()).toEqual(without);
      }
    });
  });

  it('b. switch on, U-1 score 1, no needs: one linear clause sized 0.1 x top x 1', async () => {
    await run({ urgencyBoost: u1 });
    const clauses = rankFeatures(mainRequest());
    expect(clauses).toHaveLength(1);
    expect(clauses[0].rank_feature.field).toBe('sune_urgency_weights.U-1');
    expect(clauses[0].rank_feature.linear).toEqual({});
    expect(clauses[0].rank_feature.boost).toBeCloseTo(FRACTION * 200 * 1, 6);
  });

  it('c. need and urgency: two clauses, the need clause as in the need-only request', async () => {
    await run({ needScores: tier2Fod });
    const needOnly = rankFeatures(mainRequest());
    expect(needOnly).toHaveLength(1);

    await build();
    await run({ needScores: tier2Fod, urgencyBoost: u1 });
    const clauses = rankFeatures(mainRequest());
    expect(clauses).toHaveLength(2);
    expect(clauses[0]).toEqual(needOnly[0]);
    expect(clauses[1].rank_feature.field).toBe('sune_urgency_weights.U-1');
  });

  it.each([
    ['U-0', 1],
    ['U-X', 1],
    ['U-5', 1],
    ['U-1', NaN],
    ['U-1', 0],
    ['U-1', -1],
    ['U-1', Infinity],
  ])('d. urgency %s score %p changes nothing', async (code, score) => {
    await run();
    const without = mainRequest();
    await build();
    await run({ urgencyBoost: { code, score } as any });
    expect(mainRequest()).toEqual(without);
    expect(usesUrgency(requests)).toBe(false);
  });

  it('e. cutoff probe: tagged head filters and reads sune_urgency_weights.U-1; a hit without weights adds 0', async () => {
    taggedHeadHits = [
      {
        _id: 'with',
        _score: 60,
        _source: { sune_urgency_weights: { 'U-1': 0.5 } },
      },
      { _id: 'without', _score: 59, _source: {} },
    ];
    const res: any = await run({
      urgencyBoost: u1,
      query: { ...geoQuery, relevance_cutoff: 'on' },
    });
    expect(res.search.hits.total.value).toBeGreaterThan(0);

    const tagged = requests.find(isTaggedHead);
    expect(tagged._source).toEqual(['sune_urgency_weights.U-1']);
    expect(JSON.stringify(tagged.query)).toContain(
      '{"exists":{"field":"sune_urgency_weights.U-1"}}',
    );
    const headCall = requests.find((r) => r._source === false && r.size === 21);
    expect(JSON.stringify(headCall)).not.toContain('rank_feature');
    // the boosted probe head (size 1001) carries the urgency clause
    const boosted = requests.find((r) => r.size === 1001);
    expect(boosted).toBeDefined();
    expect(JSON.stringify(boosted.query)).toContain(
      '"field":"sune_urgency_weights.U-1"',
    );
  });

  it('e2. the probe weight read: no weights on a service means boost 0', () => {
    const term = { code: 'U-1', tier: 'urgency', score: 1 };
    const read = (service as any).boostWeightOf.bind(service);
    expect(read({}, term)).toBe(0);
    expect(read(undefined, term)).toBe(0);
    expect(read({ sune_urgency_weights: { 'U-1': 'x' } }, term)).toBe(0);
    expect(read({ sune_urgency_weights: { 'U-1': 0.4 } }, term)).toBe(0.4);
    // a need reads the need group, not the urgency group
    const need = { code: 'N-FOD-01', tier: 'tier2', score: 0.98 };
    expect(
      read(
        { sune_need_weights: { 'N-FOD-01': 0.7 }, sune_urgency_weights: {} },
        need,
      ),
    ).toBe(0.7);
  });

  it('f. fused path: the need list holds the urgency clause with boost score x 1', async () => {
    await run({
      urgencyBoost: { code: 'U-2', score: 0.95 },
      query: fusedQuery,
    });
    const list = requests.find(isNeedList);
    expect(list).toBeDefined();
    const clauses = list.query.bool.should;
    expect(clauses).toHaveLength(1);
    expect(clauses[0].rank_feature.field).toBe('sune_urgency_weights.U-2');
    expect(clauses[0].rank_feature.boost).toBeCloseTo(0.95, 6);
  });

  it('g. v1 (no urgencyBoost): the requests are identical with the switch on or off', async () => {
    urgencySwitch = undefined;
    await build();
    await run({ rankingVersion: undefined });
    const off = JSON.stringify(requests);

    urgencySwitch = 'true';
    await build();
    await run({ rankingVersion: undefined });
    expect(JSON.stringify(requests)).toEqual(off);
  });

  describe('i need food now with U-1 lifts U-1 services', () => {
    type Svc = {
      id: string;
      base: number;
      needW: number;
      urgency?: Record<string, number>;
    };
    const services = (withUrgency: boolean): Svc[] =>
      [
        { id: 'A', base: 10.0, needW: 1, urgency: { 'U-3': 0.8 } },
        { id: 'B', base: 9.6, needW: 1, urgency: { 'U-1': 0.9 } },
        { id: 'C', base: 9.3, needW: 1 },
        { id: 'D', base: 9.0, needW: 1, urgency: { 'U-1': 0.4 } },
      ].map((s) => (withUrgency ? s : { ...s, urgency: undefined }));

    // ES scores a linear rank_feature as boost x feature value.
    const orderWith = async (
      urgencyBoost: Urgency | undefined,
      svcs: Svc[],
    ) => {
      topScore = 10;
      await build();
      await run({ needScores: tier2Fod, urgencyBoost });
      const clauses = rankFeatures(mainRequest());
      const scoreOf = (s: Svc) =>
        s.base +
        clauses.reduce((sum: number, c: any) => {
          const [group, code] = c.rank_feature.field.split('.');
          const w =
            group === 'sune_need_weights' ? s.needW : (s.urgency?.[code] ?? 0);
          return sum + c.rank_feature.boost * w;
        }, 0);
      return [...svcs]
        .sort((a, b) => scoreOf(b) - scoreOf(a))
        .map((s) => s.id)
        .join('');
    };

    it('without urgency the order is A, B, C, D', async () => {
      expect(await orderWith(undefined, services(true))).toBe('ABCD');
    });

    it('with U-1 the order is B, A, D, C', async () => {
      expect(await orderWith(u1, services(true))).toBe('BADC');
    });

    it('with U-1 and no service carrying urgency weights the order is unchanged', async () => {
      expect(await orderWith(u1, services(false))).toBe('ABCD');
    });
  });
});
