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
        sort: [1.7e38, 7],
        _source: { name: 'Shelter', facets: {}, facets_en: {} },
      },
    ],
  },
  aggregations: {},
};

const range = (a: number, b: number) =>
  Array.from({ length: b - a }, (_, i) => `s${a + i}`);

describe('HybridSearchService — RRF lists start before the cut (ISS-2499)', () => {
  let service: HybridSearchService;
  let requests: any[];
  let keptList: string[]; // what the probe keeps
  let survivorsCount: number | undefined; // overrides the count answer
  let universe: Record<'keyword' | 'vector' | 'taxonomy', string[]>;
  let headGate: Promise<void> | undefined;
  let rejectFirstVectorPrecut = false;

  const kindOf = (r: any) =>
    r.query.script_score
      ? r.query.script_score.query.bool.should
        ? 'taxonomy'
        : 'vector'
      : 'keyword';
  const isList = (r: any) =>
    r._source === false && (r.size === 100 || r.size === 300);
  const precut = () => requests.filter((r) => isList(r) && r.size === 300);
  const afterCut = () => requests.filter((r) => isList(r) && r.size === 100);
  const filterOf = (r: any) =>
    r.query.script_score
      ? r.query.script_score.query.bool.filter
      : r.query.bool.filter;
  const idsOf = (r: any): string[] | undefined =>
    filterOf(r).find((f: any) => f.ids)?.ids.values;
  const mainRequest = () =>
    requests.find((r) => r.size === 25 && r.min_score == null);

  // Oracle: today's lists (the ids filter in the query, top 100) fused.
  const oracle = (kept: string[] | null): string[] => {
    const lists = (['keyword', 'vector', 'taxonomy'] as const).map((k) => {
      const ids = kept
        ? universe[k].filter((id) => kept.includes(id))
        : universe[k];
      return ids.slice(0, 100);
    });
    return reciprocalRankFusion(lists, 60, [1, 1, 1]).slice(0, 100);
  };

  let vectorPrecutSeen = 0;
  const build = async () => {
    requests = [];
    vectorPrecutSeen = 0;
    const esSearch = jest.fn((req: any) => {
      if (req.index === 'hybrid_taxonomies') {
        return Promise.resolve(taxonomyResponse);
      }
      if (req.size === 0 && req.aggs?.df) {
        return Promise.reject(new Error('rarity not under test'));
      }
      requests.push(req);

      if (isList(req)) {
        const kind = kindOf(req);
        if (
          rejectFirstVectorPrecut &&
          kind === 'vector' &&
          req.size === 300 &&
          vectorPrecutSeen++ === 0
        ) {
          return Promise.reject(new Error('es down'));
        }
        const wanted = idsOf(req);
        const ids = wanted
          ? universe[kind].filter((id) => wanted.includes(id))
          : universe[kind];
        return Promise.resolve({
          hits: { hits: ids.slice(0, req.size).map((id) => ({ _id: id })) },
        });
      }
      if (req._source === false && req.size === 21) {
        const respond = () =>
          Promise.resolve({
            hits: {
              total: { value: 1234, relation: 'eq' },
              hits: Array.from({ length: 21 }, (_, i) => ({
                _id: i === 0 ? 'top' : `rank-${i}`,
                _score: i === 0 ? 100 : 20,
              })),
            },
          });
        return headGate ? headGate.then(respond) : respond();
      }
      if (req.size === 0 && req.min_score != null) {
        return Promise.resolve({
          hits: {
            total: {
              value: survivorsCount ?? keptList.length,
              relation: 'eq',
            },
            hits: [],
          },
        });
      }
      if (req.min_score != null && Array.isArray(req._source)) {
        return Promise.resolve({
          hits: {
            hits: keptList.map((id) => ({
              _id: id,
              _score: req.min_score,
              _source: { service_id: `svc-${id}` },
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

  const run = () =>
    service.searchHybrid({
      headers,
      query: {
        query: 'food shelf',
        page: 1,
        limit: 25,
        filters: {},
        distance: 0,
        taxonomy: [],
        relevance_cutoff: 'on',
      },
      rankingVersion: 'v2',
    } as any);

  // keyword: s0..s399. vector: blocks of 10 reversed, so its order differs.
  // taxonomy: s0..s49 (shorter than the pre-cut size, so exhausted).
  const defaultUniverse = () => ({
    keyword: range(0, 400),
    vector: Array.from({ length: 40 }, (_, b) =>
      range(b * 10, b * 10 + 10).reverse(),
    ).flat(),
    taxonomy: range(0, 50),
  });

  beforeEach(async () => {
    headGate = undefined;
    survivorsCount = undefined;
    rejectFirstVectorPrecut = false;
    keptList = range(0, 150);
    universe = defaultUniverse();
    await build();
  });

  it('a. keyword and vector lists are sent before the probe head resolves; taxonomy too', async () => {
    let release!: () => void;
    headGate = new Promise<void>((r) => (release = r));
    const pending = run();
    for (let i = 0; i < 50 && precut().length < 3; i++) {
      await new Promise((r) => setImmediate(r));
    }

    expect(precut().map(kindOf).sort()).toEqual([
      'keyword',
      'taxonomy',
      'vector',
    ]);
    expect(requests.some((r) => r.size === 21)).toBe(true); // head is out
    expect(afterCut()).toHaveLength(0);
    // no ids filter yet
    for (const r of precut()) expect(idsOf(r)).toBeUndefined();

    release();
    await pending;
  });

  it('b. complete lists (>= 100 kept in each): no re-run, fused order equals the ids-filtered order', async () => {
    await run();

    expect(afterCut()).toHaveLength(0);
    expect(mainRequest().query.pinned.ids).toEqual(oracle(keptList));
  });

  it('c. one incomplete list is re-run with the ids filter, nothing else is', async () => {
    // 30 kept ids that sit past the keyword list's first 300, and first in
    // the vector list: the keyword list is incomplete, the vector list is not.
    keptList = range(350, 380);
    universe.vector = [
      ...range(350, 380),
      ...range(0, 350),
      ...range(380, 400),
    ];
    await build();
    await run();

    const rerun = afterCut();
    expect(rerun.map(kindOf)).toEqual(['keyword']);
    expect(rerun[0].size).toBe(100);
    expect(idsOf(rerun[0])).toEqual(keptList);
    expect(mainRequest().query.pinned.ids).toEqual(oracle(keptList));
  });

  it('d. no cut (probe declines): lists are the top 100 of the pre-cut lists, no re-run', async () => {
    survivorsCount = 1200; // >= 90% of 1234: no elbow
    await run();

    expect(afterCut()).toHaveLength(0);
    expect(precut()).toHaveLength(3);
    expect(mainRequest().query.pinned.ids).toEqual(oracle(null));
  });

  it('e. a pre-cut list rejects: all lists are sent again after the cut, as today', async () => {
    rejectFirstVectorPrecut = true;
    await build();
    await run();

    const after = afterCut();
    expect(after.map(kindOf).sort()).toEqual(['keyword', 'taxonomy', 'vector']);
    for (const r of after) expect(idsOf(r)).toEqual(keptList);
    expect(mainRequest().query.pinned.ids).toEqual(oracle(keptList));
  });
});
