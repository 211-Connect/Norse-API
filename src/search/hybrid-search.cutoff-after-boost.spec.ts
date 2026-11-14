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
const OWN_TOP = 100; // the probe's unboosted top score
const MAIN_TOP = 200; // the main search's top score (it includes distance)

type Doc = { id: string; base: number; weight: number };

// 1 top doc, 25 strong docs, the need-tagged doc and an untagged twin just
// under the threshold (0.2 x 100 = 20), then 40 weak docs.
const docs: Doc[] = [
  { id: 'top', base: OWN_TOP, weight: 0 },
  ...Array.from({ length: 25 }, (_, i) => ({
    id: `strong-${i}`,
    base: 50,
    weight: 0,
  })),
  { id: 'tagged', base: 18, weight: 1 },
  { id: 'untagged', base: 18, weight: 0 },
  ...Array.from({ length: 40 }, (_, i) => ({
    id: `weak-${i}`,
    base: 5,
    weight: 0,
  })),
];

type Needs = { code: string; tier: 'tier1' | 'tier2'; score: number }[];
const tier2Fod: Needs = [{ code: 'N-FOD-01', tier: 'tier2', score: 0.98 }];
const tier2Hou: Needs = [{ code: 'N-HOU-01', tier: 'tier2', score: 0.98 }];

describe('HybridSearchService — cutoff after the need boost (ISS-2499, option A)', () => {
  let service: HybridSearchService;
  let requests: any[];
  let cacheKeys: string[];
  let enabled: string | undefined;
  let gate: Promise<void> | undefined;

  // The simulated index: a probe request scores each document as its base plus
  // the rank_feature boost the request carries (weight 1 for the tagged doc).
  const scoreOf = (req: any, d: Doc): number => {
    const features: any[] = [];
    const walk = (n: any) => {
      if (!n || typeof n !== 'object') return;
      if (n.rank_feature) features.push(n.rank_feature);
      Object.values(n).forEach(walk);
    };
    walk(req.query);
    return d.base + features.reduce((s, f) => s + f.boost * d.weight, 0);
  };

  const hasGauss = (r: any) => JSON.stringify(r.query).includes('"gauss"');
  const isTopCall = (r: any) =>
    r.size === 1 && r._source === false && r.min_score == null;
  const probeOwnTop = () =>
    requests.filter((r) => isTopCall(r) && !hasGauss(r));
  const mainTop = () => requests.filter((r) => isTopCall(r) && hasGauss(r));
  const isProbeCall = (r: any) =>
    (r._source === false && r.size === 21) ||
    (r.size === 0 && r.min_score != null) ||
    (r.min_score != null && Array.isArray(r._source));
  const probeCalls = () => requests.filter(isProbeCall);
  const mainRequest = () =>
    requests.find(
      (r) => !isTopCall(r) && !isProbeCall(r) && r.size !== undefined,
    );
  const hasRankFeature = (r: any) => JSON.stringify(r).includes('rank_feature');
  const withoutPreference = (r: any) => {
    return { ...r, preference: undefined };
  };

  const build = async () => {
    requests = [];
    cacheKeys = [];
    const esSearch = jest.fn((req: any) => {
      if (req.index === 'hybrid_taxonomies') {
        return Promise.resolve(taxonomyResponse);
      }
      // word-rarity lookup: not part of the request sequence under test
      if (req.size === 0 && req.aggs?.df) {
        return Promise.reject(new Error('rarity not under test'));
      }
      requests.push(req);

      if (isTopCall(req)) {
        const top = hasGauss(req) ? MAIN_TOP : OWN_TOP;
        const respond = () =>
          Promise.resolve({ hits: { hits: [{ _id: 'top', _score: top }] } });
        return gate ? gate.then(respond) : respond();
      }
      if (req._source === false && req.size === 21) {
        const sorted = docs
          .map((d) => ({ _id: d.id, _score: scoreOf(req, d) }))
          .sort((a, b) => b._score - a._score);
        return Promise.resolve({
          hits: {
            total: { value: docs.length, relation: 'eq' },
            hits: sorted.slice(0, 21),
          },
        });
      }
      if (req.size === 0 && req.min_score != null) {
        const n = docs.filter((d) => scoreOf(req, d) >= req.min_score).length;
        return Promise.resolve({
          hits: { total: { value: n, relation: 'eq' }, hits: [] },
        });
      }
      if (req.min_score != null && Array.isArray(req._source)) {
        const kept = docs
          .filter((d) => scoreOf(req, d) >= req.min_score)
          .sort((a, b) => scoreOf(req, b) - scoreOf(req, a));
        return Promise.resolve({
          hits: {
            hits: kept.slice(0, req.size).map((d) => ({
              _id: d.id,
              _score: scoreOf(req, d),
              _source: { service_id: `svc-${d.id}` },
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
            getSearchConfig: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: RequestCacheService,
          useValue: {
            getOrSet: jest.fn((k: string, f: any) => {
              if (k.startsWith('search:cutoff:')) cacheKeys.push(k);
              return f();
            }),
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
    distance: 25,
    coords: [-93.1, 44.9],
    taxonomy: [] as string[],
  } as any;

  const run = (
    needScores: Needs | undefined,
    overrides: Record<string, unknown> = {},
    rankingVersion: 'v1' | 'v2' = 'v2',
  ) =>
    service.searchHybrid({
      headers,
      query: { ...baseQuery, relevance_cutoff: 'on', ...overrides },
      needScores,
      rankingVersion,
    } as any);

  const keptIdsOfMain = () =>
    JSON.stringify(mainRequest().query).match(
      /"ids":\{"values":(\[[^\]]*\])/,
    )?.[1];

  beforeEach(async () => {
    enabled = 'true';
    gate = undefined;
    await build();
  });

  it('1. probe requests carry the boost clause sized at 10% of the probe own top score', async () => {
    await run(tier2Fod);

    const own = probeOwnTop();
    expect(own).toHaveLength(1);
    expect(hasRankFeature(own[0])).toBe(false);

    const head = probeCalls().find((r) => r.size === 21);
    const clauses: any[] = [];
    const walk = (n: any) => {
      if (!n || typeof n !== 'object') return;
      if (n.rank_feature) clauses.push(n.rank_feature);
      Object.values(n).forEach(walk);
    };
    walk(head.query);
    expect(clauses).toHaveLength(1);
    expect(clauses[0].field).toBe('sune_need_weights.N-FOD-01');
    // 10% of 100 (the probe's own top), not 10% of 200 (the main search's top)
    expect(clauses[0].boost).toBeCloseTo(FRACTION * OWN_TOP * 0.98, 6);
    // every probe call carries the same boost
    for (const call of probeCalls()) {
      expect(JSON.stringify(call.query)).toContain(
        'sune_need_weights.N-FOD-01',
      );
    }
    // the main search keeps its own size
    expect(mainRequest()).toBeDefined();
  });

  it('1b. the probe boost, scoring and kept ids do not depend on position or distance', async () => {
    // The geo filter legitimately differs; the scoring parts must not.
    const scoring = (r: any) => ({
      functions: r.query.function_score.functions,
      should: r.query.function_score.query.bool.should,
      size: r.size,
      min_score: r.min_score,
    });

    await run(tier2Fod);
    const first = probeCalls().map(scoring);
    const firstIds = keptIdsOfMain();

    await build();
    await run(tier2Fod, { coords: [-122.0, 36.9], distance: 60 });
    const second = probeCalls().map(scoring);

    expect(first.length).toBeGreaterThanOrEqual(3);
    expect(second).toEqual(first);
    expect(JSON.stringify(first)).not.toContain('gauss');
    expect(keptIdsOfMain()).toBe(firstIds);
    expect(firstIds).toContain('tagged');
  });

  it('2. a need-tagged result just below the unboosted threshold survives the cut', async () => {
    await run(tier2Fod);
    const ids = keptIdsOfMain();
    expect(ids).toContain('tagged'); // 18 + 9.8 >= 20
    expect(ids).not.toContain('untagged'); // 18 < 20

    // without the boost the same result is cut
    enabled = undefined;
    await build();
    await run(tier2Fod);
    expect(keptIdsOfMain()).not.toContain('tagged');
  });

  it('3. cutoff on and boost inactive: requests equal to the no-needs requests', async () => {
    enabled = undefined;
    await build();
    await run(undefined);
    const baseline = requests.map(withoutPreference);

    await build();
    await run(tier2Fod);

    expect(requests.map(withoutPreference)).toEqual(baseline);
    expect(probeOwnTop()).toHaveLength(0);
    expect(mainTop()).toHaveLength(0);
    expect(requests.some(hasRankFeature)).toBe(false);
    expect(probeCalls()).toHaveLength(3);
  });

  it('3b. boost on but only sub-gate needs: same requests as no needs', async () => {
    await run(undefined);
    const baseline = requests.map(withoutPreference);

    await build();
    await run([{ code: 'N-FOD-01', tier: 'tier2', score: 0.96 }]);

    expect(requests.map(withoutPreference)).toEqual(baseline);
  });

  it('4. cutoff off: no extra call, only the main top-score call and the main search', async () => {
    await run(tier2Fod, { relevance_cutoff: 'off' });

    expect(probeCalls()).toHaveLength(0);
    expect(probeOwnTop()).toHaveLength(0);
    expect(mainTop()).toHaveLength(1);
    expect(requests).toHaveLength(2);
  });

  it('5. v1 path unchanged: no probe boost, boost top score after the cut with the ids filter', async () => {
    await run(tier2Fod, {}, 'v1');

    expect(probeOwnTop()).toHaveLength(0);
    for (const call of probeCalls()) expect(hasRankFeature(call)).toBe(false);
    expect(probeCalls()).toHaveLength(3);

    const top = mainTop();
    expect(top).toHaveLength(1);
    expect(JSON.stringify(top[0].query)).toContain('"ids"');
    // the top-score call comes after the probe's last call
    expect(requests.indexOf(top[0])).toBeGreaterThan(
      requests.indexOf(probeCalls()[2]),
    );
  });

  it('6. the cutoff cache key separates different needs and keeps the old key without a boost', async () => {
    await run(tier2Fod);
    await run(tier2Hou);
    await run([{ code: 'N-FOD-01', tier: 'tier2', score: 0.99 }]);
    await run(tier2Fod);
    expect(new Set(cacheKeys).size).toBe(3);
    expect(cacheKeys[0]).toBe(cacheKeys[3]);

    enabled = undefined;
    await build();
    await run(tier2Fod);
    await run(undefined);
    expect(cacheKeys[0]).toBe(cacheKeys[1]);
  });

  it('7. the probe top-score call and the main top-score call start before either is awaited', async () => {
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));

    const pending = run(tier2Fod);
    await new Promise((r) => setImmediate(r));

    expect(probeOwnTop()).toHaveLength(1);
    expect(mainTop()).toHaveLength(1);
    expect(probeCalls()).toHaveLength(0); // nothing past the top-score calls yet

    release();
    await pending;
    expect(probeCalls().length).toBeGreaterThanOrEqual(3);
  });

  it('8. the probe boost call failing leaves the probe unboosted and the search still returns', async () => {
    const original = (service as any).fetchTopScore.bind(service);
    jest
      .spyOn(service as any, 'fetchTopScore')
      .mockImplementation((op: string, a: any) =>
        op === 'hybrid_cutoff_boost_top_score'
          ? Promise.resolve(0)
          : original(op, a),
      );
    const res: any = await run(tier2Fod);

    for (const call of probeCalls()) expect(hasRankFeature(call)).toBe(false);
    expect(res.search.hits.total.value).toBe(1234);
  });
});
