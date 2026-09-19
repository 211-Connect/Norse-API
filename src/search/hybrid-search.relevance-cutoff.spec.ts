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

/** A probe response with a cliff after `cliffAt` results. */
const probeResponse = (total: number, count: number, cliffAt: number) => ({
  hits: {
    total: { value: total, relation: 'eq' },
    hits: Array.from({ length: count }, (_, i) => ({
      _id: `doc-${i}`,
      _score: i < cliffAt ? 90 - i * 0.5 : 12 - i * 0.05,
    })),
  },
});

/** A probe response with no cliff at all — the sparse-geography shape. */
const flatProbeResponse = (total: number, count: number) => ({
  hits: {
    total: { value: total, relation: 'eq' },
    hits: Array.from({ length: count }, (_, i) => ({
      _id: `doc-${i}`,
      _score: Number((42 - i * 0.3).toFixed(4)),
    })),
  },
});

describe('HybridSearchService — relevance cutoff (ISS-1752)', () => {
  let service: HybridSearchService;
  let esSearch: jest.Mock;
  let requests: any[];
  let probeResult: any;

  const build = async () => {
    requests = [];
    esSearch = jest.fn((req: any) => {
      if (req.index === 'hybrid_taxonomies') {
        return Promise.resolve(taxonomyResponse);
      }
      requests.push(req);
      // The probe is the one that asks for no _source.
      if (req._source === false) {
        return Promise.resolve(probeResult);
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
          useValue: { getOrSet: jest.fn((_key, factory) => factory()) },
        },
      ],
    }).compile();

    service = module.get<HybridSearchService>(HybridSearchService);
    jest.spyOn(service, 'embedQuery').mockResolvedValue([0.1, 0.2, 0.3, 0.4]);
  };

  beforeEach(async () => {
    probeResult = probeResponse(1234, 300, 18);
    await build();
  });

  const baseQuery = {
    query: 'food shelf',
    page: 1,
    limit: 25,
    filters: {},
    distance: 0,
    taxonomy: [] as string[],
  } as any;

  const mainRequest = () => requests.find((r) => r._source !== false);
  const probeRequest = () => requests.find((r) => r._source === false);

  describe('when the caller does not opt in', () => {
    // This is the guard against existing consumers' behaviour shifting. If it
    // goes red, someone changed what /search returns for callers who never
    // asked for a cutoff.
    it('issues exactly one search and no probe', async () => {
      await service.searchHybrid({ headers, query: baseQuery });

      expect(requests).toHaveLength(1);
      expect(probeRequest()).toBeUndefined();
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

  describe('when score_gap finds a cliff', () => {
    it('constrains the main query to the kept ids', async () => {
      await service.searchHybrid({
        headers,
        query: { ...baseQuery, relevance_cutoff: 'score_gap' },
      });

      const idsFilter =
        mainRequest().query.function_score.query.bool.filter.find(
          (clause: any) => clause.ids,
        );

      expect(idsFilter.ids.values).toHaveLength(18);
      expect(idsFilter.ids.values[0]).toBe('doc-0');
      expect(idsFilter.ids.values).not.toContain('doc-18');
    });

    it('reports the kept count and preserves the pre-cutoff total', async () => {
      const response: any = await service.searchHybrid({
        headers,
        query: { ...baseQuery, relevance_cutoff: 'score_gap' },
      });

      expect(response.relevance_cutoff).toEqual({
        strategy: 'score_gap',
        applied: true,
        reason: null,
        kept: 18,
        matched_before_cutoff: 1234,
        cutoff_score: 90 - 17 * 0.5,
        candidates_examined: 300,
      });
    });
  });

  describe('the probe query', () => {
    it('excludes geography from the score it cuts on', async () => {
      await service.searchHybrid({
        headers,
        query: {
          ...baseQuery,
          relevance_cutoff: 'score_gap',
          coords: [-93.1, 44.9],
          distance: 25,
        },
      });

      const probeFunctions =
        probeRequest().query.function_score.functions ?? [];

      // Distance is still allowed to rank and to filter on the main query...
      expect(JSON.stringify(mainRequest())).toContain('gauss');
      // ...but it must not decide what gets cut. Someone rural may travel far
      // for the right resource; that is not evidence of irrelevance.
      expect(probeFunctions.some((fn: any) => fn.gauss)).toBe(false);
      expect(probeFunctions.some((fn: any) => fn.script_score)).toBe(true);
    });

    it('carries the geo filters so the probe ranks the same population', async () => {
      await service.searchHybrid({
        headers,
        query: {
          ...baseQuery,
          relevance_cutoff: 'score_gap',
          coords: [-93.1, 44.9],
          distance: 25,
        },
      });

      expect(
        JSON.stringify(probeRequest().query.function_score.query),
      ).toContain('geo_distance');
    });

    it('fetches no _source and orders strictly by score', async () => {
      await service.searchHybrid({
        headers,
        query: {
          ...baseQuery,
          relevance_cutoff: 'score_gap',
          sort: 'distance',
        },
      });

      expect(probeRequest()._source).toBe(false);
      expect(probeRequest().sort).toEqual(['_score']);
      expect(probeRequest().size).toBe(300);
    });
  });

  describe('when there is no cliff', () => {
    beforeEach(async () => {
      probeResult = flatProbeResponse(120, 120);
      await build();
    });

    it('returns everything and says why', async () => {
      const response: any = await service.searchHybrid({
        headers,
        query: { ...baseQuery, relevance_cutoff: 'score_gap' },
      });

      expect(response.relevance_cutoff).toMatchObject({
        applied: false,
        reason: 'no_elbow',
        kept: 120,
        matched_before_cutoff: 120,
      });
      expect(JSON.stringify(mainRequest())).not.toContain('"ids"');
    });
  });

  describe('when the elbow may lie beyond the probed window', () => {
    beforeEach(async () => {
      // 300 candidates examined out of 5000 matched, and no cliff among them.
      probeResult = flatProbeResponse(5000, 300);
      await build();
    });

    it('reports candidate_ceiling rather than claiming there was nothing to cut', async () => {
      const response: any = await service.searchHybrid({
        headers,
        query: { ...baseQuery, relevance_cutoff: 'score_gap' },
      });

      expect(response.relevance_cutoff.applied).toBe(false);
      expect(response.relevance_cutoff.reason).toBe('candidate_ceiling');
      expect(response.relevance_cutoff.candidates_examined).toBe(300);
    });
  });

  describe('sort interaction', () => {
    it('cuts by relevance and still lets sort order the survivors', async () => {
      await service.searchHybrid({
        headers,
        query: {
          ...baseQuery,
          relevance_cutoff: 'score_gap',
          sort: 'name',
          coords: [-93.1, 44.9],
        },
      });

      // Membership decided by relevance...
      const idsFilter =
        mainRequest().query.function_score.query.bool.filter.find(
          (clause: any) => clause.ids,
        );
      expect(idsFilter.ids.values).toHaveLength(18);
      // ...ordering still by the caller's sort. A cut that walked the response
      // list would be meaningless here, because these hits are not score-ordered.
      expect(JSON.stringify(mainRequest().sort)).toContain('name.lc');
    });
  });
});
