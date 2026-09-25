import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { HybridSearchService } from './hybrid-search.service';
import { TenantConfigService } from '../cms-config/tenant-config.service';
import { RequestCacheService } from 'src/common/services/cache/request-cache.service';

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
  rank20Score?: number;
  countsByMinScore?: Record<number, number>;
  headHits?: number;
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

      // 1. head — the top CUTOFF_TOP_DOCS_FLOOR + 1 scores and the matched
      //    total. Keyed on _source === false with no min_score: the count and
      //    survivor calls both carry a min_score, the head does not.
      if (req._source === false && req.min_score == null) {
        const n = plan.headHits ?? 21;
        return Promise.resolve({
          hits: {
            total: { value: plan.matched, relation: 'eq' },
            hits: Array.from({ length: n }, (_, i) => ({
              _id: i === 0 ? 'top' : `rank-${i}`,
              _score:
                i === 0
                  ? plan.topScore
                  : (plan.rank20Score ?? plan.topScore * 0.2),
            })),
          },
        });
      }
      // 2. count above the threshold, no documents collected. The ladder sends
      //    several of these; countsByMinScore answers per threshold. Tolerance
      //    lookup because 0.3 * 100 is not exactly 30 in IEEE arithmetic.
      if (req.size === 0 && req.min_score != null) {
        const entry = Object.entries(plan.countsByMinScore ?? {}).find(
          ([k]) => Math.abs(Number(k) - req.min_score) < 1e-6,
        );
        return Promise.resolve({
          hits: {
            total: {
              value: entry ? entry[1] : plan.survivors,
              relation: 'eq',
            },
            hits: [],
          },
        });
      }
      // 3. the survivors themselves — the last kept doc's score is the
      //    threshold, so cutoff_score stays meaningful for every rung
      if (req.min_score != null && Array.isArray(req._source)) {
        const svc = plan.keptServices ?? [];
        return Promise.resolve({
          hits: {
            hits: Array.from({ length: req.size }, (_, i) => ({
              _id: `keep-${i}`,
              _score: req.min_score,
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

  describe('the top-20 clamp', () => {
    it('asks the head call for the floor + 1 scores', async () => {
      await run();

      const head = requests.find((r) => r._source === false);
      expect(head.size).toBe(21);
      expect(head._source).toBe(false);
      expect(head.sort).toEqual(['_score']);
    });

    it('clamps the threshold to the top-20 score when it sits below the fraction', async () => {
      // 0.2 x 300 = 60, but the probe's own 20th result scores 50: cutting at
      // 60 would remove the probe's top 19..20, so the threshold clamps to 50.
      plan = { matched: 1234, topScore: 300, rank20Score: 50, survivors: 24 };
      const response = await run();

      const counting = requests.find(
        (r) => r.size === 0 && r.min_score != null,
      );
      expect(counting.min_score).toBe(50);
      expect(response.relevance_cutoff).toMatchObject({
        applied: true,
        kept: 24,
        cutoff_score: 50,
        candidates_examined: 24,
      });
    });

    it('keeps a tie group at the clamp whole', async () => {
      // min_score is inclusive: every document tied at the threshold goes with
      // the group — the boundary cannot split a tie.
      plan = {
        matched: 1234,
        topScore: 300,
        rank20Score: 50,
        survivors: 27,
        countsByMinScore: { 50: 27 },
      };
      const response = await run();

      expect(response.relevance_cutoff.applied).toBe(true);
      expect(response.relevance_cutoff.kept).toBe(27);
      expect(response.relevance_cutoff.cutoff_score).toBe(50);
    });

    it('does not clamp when fewer than the floor + 1 hits come back', async () => {
      plan = { matched: 12, topScore: 100, survivors: 5, headHits: 12 };
      const response = await run();

      // no 21st score, so nothing to clamp to: the fraction alone decides
      const countScores = requests
        .filter((r) => r.size === 0 && r.min_score != null)
        .map((r) => r.min_score);
      expect(countScores).toEqual([20]);
      expect(response.relevance_cutoff.applied).toBe(true);
      expect(response.relevance_cutoff.kept).toBe(5);
    });
  });

  describe('the fraction ladder', () => {
    it('climbs to the first rung that enumerates and stops there', async () => {
      // Washington Q7's measured distribution: 0.2 leaves 5,524 survivors,
      // each rung thins it, 0.5 finally fits under MAX_ENUMERATED_CUT.
      plan = {
        matched: 15700,
        topScore: 100,
        // rank 20 sits inside the survivors on this path, so its score is well
        // above the base fraction and cannot clamp any rung
        rank20Score: 60,
        survivors: 5524,
        countsByMinScore: { 20: 5524, 25: 3504, 30: 2788, 40: 1064, 50: 490 },
      };
      const response = await run();

      const countScores = requests
        .filter((r) => r.size === 0 && r.min_score != null)
        .map((r) => Math.round(r.min_score));
      expect(countScores).toEqual([20, 25, 30, 40, 50]);
      expect(response.relevance_cutoff).toMatchObject({
        applied: true,
        reason: null,
        kept: 490,
        candidates_examined: 490,
        matched_before_cutoff: 15700,
      });
      expect(response.relevance_cutoff.cutoff_score).toBeCloseTo(50, 6);
    });

    it('clamps a ladder rung to the top-20 score as well', async () => {
      // The clamp cannot bind at the base fraction here (0.2 x 100 = 20 < 22),
      // but the 0.25 rung computes 25 and must clamp to 22 before counting.
      plan = {
        matched: 15700,
        topScore: 100,
        rank20Score: 22,
        survivors: 2000,
        countsByMinScore: { 20: 2000, 22: 900 },
      };
      const response = await run();

      const countScores = requests
        .filter((r) => r.size === 0 && r.min_score != null)
        .map((r) => r.min_score);
      expect(countScores).toEqual([20, 22]);
      expect(response.relevance_cutoff.applied).toBe(true);
      expect(response.relevance_cutoff.kept).toBe(900);
      expect(response.relevance_cutoff.cutoff_score).toBe(22);
    });

    it('declines with the base count when no rung enumerates', async () => {
      plan = {
        matched: 27452,
        topScore: 100,
        survivors: 1500,
        countsByMinScore: { 20: 1500, 25: 1400, 30: 1300, 40: 1200, 50: 1100 },
      };
      const response = await run();

      expect(response.relevance_cutoff).toMatchObject({
        applied: false,
        reason: 'cut_too_large',
        candidates_examined: 1500,
      });
    });
  });
});
