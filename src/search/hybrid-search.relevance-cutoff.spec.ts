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

/**
 * The probe is three calls, not one window: ask for the top score, count what
 * clears a fraction of it, and only then fetch the survivors. `plan` describes
 * the shape Elasticsearch reports back, so a test states a distribution rather
 * than a sequence of mocked responses.
 */
type Plan = {
  matched: number;
  topScore: number;
  survivors: number;
  keptServices?: string[];
  widenedServices?: string[];
};

describe('HybridSearchService — relevance cutoff (ISS-1752)', () => {
  let service: HybridSearchService;
  let requests: any[];
  let plan: Plan;

  const build = async () => {
    requests = [];
    const esSearch = jest.fn((req: any) => {
      if (req.index === 'hybrid_taxonomies') {
        return Promise.resolve(taxonomyResponse);
      }
      requests.push(req);

      // 1. head — top score and the matched total
      if (req.size === 1 && req._source === false) {
        return Promise.resolve({
          hits: {
            total: { value: plan.matched, relation: 'eq' },
            hits: [{ _id: 'top', _score: plan.topScore }],
          },
        });
      }
      // 2. count above the threshold, no documents collected
      if (req.size === 0 && req.min_score != null) {
        return Promise.resolve({
          hits: { total: { value: plan.survivors, relation: 'eq' }, hits: [] },
        });
      }
      // 3. the survivors themselves
      if (req.min_score != null && Array.isArray(req._source)) {
        const svc = plan.keptServices ?? [];
        return Promise.resolve({
          hits: {
            hits: Array.from({ length: plan.survivors }, (_, i) => ({
              _id: `keep-${i}`,
              _score: plan.topScore * 0.2,
              _source: { service_id: svc[i] ?? `svc-${i}` },
            })),
          },
        });
      }
      // 4. the widening window, used only to satisfy the service floor
      if (req.size === 200 && Array.isArray(req._source)) {
        const svc = plan.widenedServices ?? [];
        return Promise.resolve({
          hits: {
            hits: Array.from({ length: 200 }, (_, i) => ({
              _id: `wide-${i}`,
              _score: 100 - i,
              _source: { service_id: svc[i] ?? `svc-${Math.floor(i / 3)}` },
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
          useValue: { getOrSet: jest.fn((_k: any, f: any) => f()) },
        },
        {
          provide: MetricsService,
          useValue: createMetricsServiceMock(),
        },
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

  const isProbe = (r: any) => r._source === false || r.min_score != null;
  const mainRequest = () => requests.find((r) => !isProbe(r));
  const headRequest = () => requests.find((r) => r._source === false);
  const survivorRequest = () =>
    requests.find((r) => r.min_score != null && Array.isArray(r._source));

  const run = async (overrides: Record<string, unknown> = {}) => {
    await build();
    const res: any = await service.searchHybrid({
      headers,
      query: { ...baseQuery, relevance_cutoff: 'on', ...overrides },
    });
    return res;
  };

  beforeEach(async () => {
    // 1,234 matched, 18 of them above a fifth of the top score.
    plan = { matched: 1234, topScore: 100, survivors: 18 };
    await build();
  });

  describe('when the caller does not opt in', () => {
    // This is the guard against existing consumers' behaviour shifting. If it
    // goes red, someone changed what /search returns for callers who never
    // asked for a cutoff.
    it('issues exactly one search and no probe', async () => {
      await service.searchHybrid({ headers, query: baseQuery });

      expect(requests).toHaveLength(1);
      expect(requests.some(isProbe)).toBe(false);
    });

    it('builds the same request with the param absent, off, or undefined', async () => {
      await service.searchHybrid({ headers, query: baseQuery });
      const absent = mainRequest();

      await build();
      await service.searchHybrid({
        headers,
        query: { ...baseQuery, relevance_cutoff: 'off' },
      });
      const off = mainRequest();

      await build();
      await service.searchHybrid({
        headers,
        query: { ...baseQuery, relevance_cutoff: undefined },
      });

      expect(off).toEqual(absent);
      expect(mainRequest()).toEqual(absent);
      // No ids filter was introduced anywhere.
      expect(JSON.stringify(absent)).not.toContain('"ids"');
    });

    it('omits relevance_cutoff from the response document', async () => {
      const response: any = await service.searchHybrid({
        headers,
        query: baseQuery,
      });

      expect('relevance_cutoff' in response).toBe(false);
      expect(response.search.hits.total.value).toBe(1234);
    });
  });

  describe('when a cut is found', () => {
    it('constrains the main query to the kept ids', async () => {
      await run();

      const idsFilter =
        mainRequest().query.function_score.query.bool.filter.find(
          (clause: any) => clause.ids,
        );

      expect(idsFilter.ids.values).toHaveLength(18);
      expect(idsFilter.ids.values[0]).toBe('keep-0');
      expect(idsFilter.ids.values).not.toContain('keep-18');
    });

    it('reports the kept count and preserves the pre-cutoff total', async () => {
      const response = await run();

      expect(response.relevance_cutoff).toEqual({
        applied: true,
        reason: null,
        kept: 18,
        matched_before_cutoff: 1234,
        cutoff_score: 20,
        candidates_examined: 18,
      });
    });

    it('finds a cut that lies far beyond any fixed candidate window', async () => {
      // The case a 300-result window could not see. Measured on Nebraska 211:
      // 27,452 matched, 388 above 0.2 x max — 88 past where the window ended.
      plan = { matched: 27452, topScore: 100, survivors: 388 };
      const response = await run();

      expect(response.relevance_cutoff.applied).toBe(true);
      expect(response.relevance_cutoff.kept).toBe(388);
      expect(response.relevance_cutoff.matched_before_cutoff).toBe(27452);
      expect(requests.some((r) => r.size === 300)).toBe(false);
    });
  });

  describe('the probe query', () => {
    it('excludes geography from the score it cuts on', async () => {
      await run({ coords: [-93.1, 44.9], distance: 25 });

      const probeFunctions = headRequest().query.function_score.functions ?? [];

      // Distance is still allowed to rank and to filter on the main query...
      expect(JSON.stringify(mainRequest())).toContain('gauss');
      // ...but it must not decide what gets cut. Someone rural may travel far
      // for the right resource; that is not evidence of irrelevance.
      expect(probeFunctions.some((fn: any) => fn.gauss)).toBe(false);
      expect(probeFunctions.some((fn: any) => fn.script_score)).toBe(true);
    });

    it('carries the geo filters so the probe ranks the same population', async () => {
      await run({ coords: [-93.1, 44.9], distance: 25 });

      expect(
        JSON.stringify(headRequest().query.function_score.query),
      ).toContain('geo_distance');
    });

    it('fetches only the grouping key and orders strictly by score', async () => {
      await run({ sort: 'distance' });

      // The grouping key and nothing else: the probe never needs the document,
      // only enough to tell one service's locations apart from another's.
      expect(survivorRequest()._source).toEqual(['service_id']);
      expect(survivorRequest().sort).toEqual(['_score']);
      // and it asks for exactly the cut it already counted
      expect(survivorRequest().size).toBe(18);
    });

    it('counts before it collects, so a large cut costs one cheap call', async () => {
      plan = { matched: 27452, topScore: 100, survivors: 1500 };
      await run();

      const counting = requests.find(
        (r) => r.size === 0 && r.min_score != null,
      );
      expect(counting).toBeDefined();
      // over MAX_ENUMERATED_CUT, so the survivors were never fetched
      expect(survivorRequest()).toBeUndefined();
    });
  });

  describe('when it declines to cut', () => {
    it('returns everything on a flat distribution and says why', async () => {
      plan = { matched: 900, topScore: 100, survivors: 900 };
      const response = await run();

      expect(response.relevance_cutoff).toMatchObject({
        applied: false,
        reason: 'no_elbow',
        kept: 900,
        matched_before_cutoff: 900,
      });
      expect(JSON.stringify(mainRequest())).not.toContain('"ids"');
    });

    it('declines when almost nothing falls below the threshold', async () => {
      // Found by running it: asdfqwerzxcv on Santa Cruz kept 567 of 568 and
      // reported applied:true with a cutoff_score. Removing one document is not
      // a cut. Drop MIN_CUT_REDUCTION and this goes red.
      plan = { matched: 568, topScore: 100, survivors: 567 };
      const response = await run();

      expect(response.relevance_cutoff.applied).toBe(false);
      expect(response.relevance_cutoff.reason).toBe('no_elbow');
      expect(response.relevance_cutoff.kept).toBe(568);
    });

    it('reports cut_too_large rather than trimming a cut it will not enumerate', async () => {
      // "Found it, too big" — not "could not find it". The cut point was
      // located exactly; it is simply larger than we will put in an ids filter.
      plan = { matched: 27452, topScore: 100, survivors: 1500 };
      const response = await run();

      expect(response.relevance_cutoff.applied).toBe(false);
      expect(response.relevance_cutoff.reason).toBe('cut_too_large');
      expect(response.relevance_cutoff.candidates_examined).toBe(1500);
    });

    it('declines when the matched set is already smaller than the floor', async () => {
      plan = { matched: 4, topScore: 100, survivors: 2 };
      const response = await run();

      expect(response.relevance_cutoff.applied).toBe(false);
      expect(response.relevance_cutoff.reason).toBe('below_min_keep');
    });
  });

  describe('the floor is denominated in services, not documents', () => {
    it("widens the cut past one provider's branches", async () => {
      // Eight survivors, but they are two providers' branches. A floor of five
      // documents would have been a floor of two choices.
      plan = {
        matched: 900,
        topScore: 100,
        survivors: 8,
        keptServices: Array.from({ length: 8 }, (_, i) => `dup-${i % 2}`),
      };
      const response = await run();

      expect(response.relevance_cutoff.applied).toBe(true);
      // the widened window groups every three documents into one service, so
      // the fifth distinct service first appears at index 12 -> 13 kept
      expect(response.relevance_cutoff.kept).toBe(13);
      expect(requests.some((r) => r.size === 200)).toBe(true);
    });
  });

  describe('sort interaction', () => {
    it('cuts by relevance and still lets sort order the survivors', async () => {
      await run({ sort: 'name', coords: [-93.1, 44.9] });

      // Membership decided by relevance...
      const idsFilter =
        mainRequest().query.function_score.query.bool.filter.find(
          (clause: any) => clause.ids,
        );
      expect(idsFilter.ids.values).toHaveLength(18);
      // ...ordering still by the caller's sort. A cut that walked the response
      // list would be meaningless here, because those hits are not score-ordered.
      expect(JSON.stringify(mainRequest().sort)).toContain('name.lc');
    });
  });
});
