import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { HybridSearchService } from './hybrid-search.service';
import { TenantConfigService } from '../cms-config/tenant-config.service';
import { RequestCacheService } from 'src/common/services/cache/request-cache.service';
import { createMetricsServiceMock } from 'src/metrics/testing/metrics-service.mock';
import { MetricsService } from 'src/metrics/metrics.service';

const headers = { 'x-tenant-id': 'tenant-a', 'accept-language': 'en' } as any;

// Window scores, descending: 1 top at 100, then 150 hits at 50, 49 at 1.
const windowScores = (n = 200, top = 100): number[] => [
  top,
  ...Array.from({ length: n - 1 }, (_, i) => (i < 150 ? 50 : 1)),
];

describe('HybridSearchService, windowed relevance cut (V2_CUTOFF_WINDOW)', () => {
  let service: HybridSearchService;
  let requests: any[];
  let flag: string | undefined;
  let scores: number[];
  let cacheCalls: number;

  const isWindow = (r: any) => r.knn !== undefined;
  const pageRequest = () =>
    requests.find((r) => r.track_total_hits === true && r.size !== 0);

  const build = async () => {
    requests = [];
    cacheCalls = 0;
    const esSearch = jest.fn((req: any) => {
      if (req.index === 'hybrid_taxonomies') {
        return Promise.resolve({ hits: { hits: [] } });
      }
      if (req.size === 0 && req.aggs?.df) {
        const buckets: Record<string, { doc_count: number }> = {};
        for (const k of Object.keys(req.aggs.df.filters.filters)) {
          buckets[k] = { doc_count: 10 };
        }
        return Promise.resolve({
          hits: { total: { value: 100, relation: 'eq' }, hits: [] },
          aggregations: { df: { buckets } },
        });
      }
      // RRF lists are not under test; they fail so the summed request remains.
      if (req._source === false && req.size === 100) {
        return Promise.reject(new Error('lists not under test'));
      }
      requests.push(req);
      if (isWindow(req)) {
        return Promise.resolve({
          took: 3,
          hits: {
            hits: scores.map((s, i) => ({ _id: `d${i}`, _score: s })),
          },
        });
      }
      // probe + page requests: tiny generic answers
      const m = JSON.stringify(req.query ?? {}).match(
        /"ids":\{"values":(\[[^\]]*\])\}/,
      );
      const n = m ? (JSON.parse(m[1]) as string[]).length : 3;
      return Promise.resolve({
        took: 1,
        timed_out: false,
        _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
        hits: {
          total: { value: n, relation: 'eq' },
          hits: [
            {
              _index: 'i',
              _id: 'd0',
              _score: 1,
              _source: { facets: {}, facets_en: {} },
              sort: [1],
            },
          ],
        },
        aggregations: {},
      });
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
              if (key === 'V2_CUTOFF_WINDOW') return flag;
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
              if (k.startsWith('search:cutoff:')) cacheCalls++;
              return f();
            }),
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
    service = module.get(HybridSearchService);
    jest.spyOn(service, 'embedQuery').mockResolvedValue([0.1, 0.2, 0.3, 0.4]);
  };

  const run = (
    overrides: Record<string, unknown> = {},
    v: 'v1' | 'v2' = 'v2',
  ) =>
    service.searchHybrid({
      headers,
      query: {
        query: 'food shelf',
        page: 1,
        limit: 25,
        filters: {},
        distance: 25,
        coords: [-93.1, 44.9],
        taxonomy: [],
        relevance_cutoff: 'on',
        ...overrides,
      },
      rankingVersion: v,
    } as any);

  const keptIds = (): string[] =>
    JSON.stringify(pageRequest().query).match(
      /"ids":\{"values":(\[[^\]]*\])/,
    )?.[1]
      ? JSON.parse(
          JSON.stringify(pageRequest().query).match(
            /"ids":\{"values":(\[[^\]]*\])/,
          )![1],
        )
      : [];

  beforeEach(async () => {
    flag = 'true';
    scores = windowScores();
    await build();
  });

  describe("flag off: today's probe", () => {
    it.each([undefined, 'false', ''])(
      'flag %p sends no window request, only probe calls',
      async (v) => {
        flag = v;
        await build();
        await run();
        expect(requests.some(isWindow)).toBe(false);
        // the probe's head call asks for 21 scores, as it always did
        expect(requests.some((r) => r.size === 21)).toBe(true);
      },
    );

    it('the request sequence with the flag unset equals the sequence with it false', async () => {
      flag = undefined;
      await build();
      await run();
      const unset = JSON.stringify(requests);
      flag = 'false';
      await build();
      await run();
      expect(JSON.stringify(requests)).toBe(unset);
    });

    it('flag on does not touch v1, a cutoff-off search, or a browse query', async () => {
      await run({}, 'v1');
      await run({ relevance_cutoff: 'off' });
      await run({ query: '' });
      expect(requests.some(isWindow)).toBe(false);
    });
  });

  describe('flag on', () => {
    it('sends one window search: BM25 leg + kNN, size 200, k 200, candidates 400, weight 100, no probe', async () => {
      await run();
      const windows = requests.filter(isWindow);
      expect(windows).toHaveLength(1);
      const w = windows[0];
      expect(w.size).toBe(200);
      expect(w.knn).toMatchObject({
        field: 'embedding',
        k: 200,
        num_candidates: 400,
        boost: 100,
      });
      // lexical required, geo decay on the BM25 leg, no cosine script
      const q = JSON.stringify(w.query);
      expect(q).toContain('"minimum_should_match":1');
      expect(q).toContain('"gauss"');
      expect(q).not.toContain('cosineSimilarity');
      expect(requests.some((r) => r.size === 1001 || r.size === 21)).toBe(
        false,
      );
    });

    it('cuts min(rank cap 100, rule): 151 above 0.2 x top -> kept 100, relation gte', async () => {
      const res = await run();
      expect(keptIds()).toHaveLength(100);
      expect(keptIds()[0]).toBe('d0');
      expect(res.search.hits.total).toEqual({ value: 100, relation: 'gte' });
      expect(res.relevance_cutoff).toMatchObject({
        applied: true,
        kept: 100,
        matched_before_cutoff: 200,
      });
    });

    it('applies the rule when it keeps fewer than the cap; relation eq when the window is not full', async () => {
      scores = [100, ...Array(29).fill(60), ...Array(20).fill(1)]; // 50 hits
      const res = await run();
      expect(keptIds()).toHaveLength(30);
      expect(res.search.hits.total).toEqual({ value: 30, relation: 'eq' });
    });

    it('relation is gte when the window is full even if the rule keeps few', async () => {
      scores = [100, ...Array(24).fill(60), ...Array(175).fill(1)]; // 200 hits
      const res = await run();
      expect(keptIds()).toHaveLength(25);
      expect(res.search.hits.total).toMatchObject({ relation: 'gte' });
    });

    it('pages inside the kept set; a page past it is the empty tail', async () => {
      await run({ page: 4, limit: 25 });
      const r = pageRequest();
      expect(r.from).toBe(75);
      expect(r.size).toBe(25);
      expect(keptIds()).toHaveLength(100); // page 5+ is empty by the ids filter
    });

    it('sort=distance runs over the kept ids only', async () => {
      await run({ sort: 'distance' });
      const r = pageRequest();
      expect(keptIds()).toHaveLength(100);
      expect(JSON.stringify(r.sort)).toContain('_geo_distance');
      expect(JSON.stringify(r.query)).not.toContain('"pinned"');
    });

    it('relevance order of the page is the window order', async () => {
      await run();
      const r = pageRequest();
      expect(r.query.pinned.ids.slice(0, 3)).toEqual(['d0', 'd1', 'd2']);
    });

    it('an empty window cuts nothing and reports no_elbow', async () => {
      scores = [];
      const res = await run();
      expect(res.relevance_cutoff).toMatchObject({
        applied: false,
        reason: 'no_elbow',
      });
      expect(res.search.hits.total).toMatchObject({ relation: 'eq' });
    });

    it('caches the window by search identity', async () => {
      await run();
      expect(cacheCalls).toBe(1);
    });
  });
});
