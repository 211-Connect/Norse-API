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
      {
        _id: 't2',
        _score: 0.6,
        _source: { code: 'BV-8900', name: 'Utilities' },
      },
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

describe('HybridSearchService', () => {
  let service: HybridSearchService;
  let esSearch: jest.Mock;
  let esCount: jest.Mock;
  let capturedMainRequest: any;

  beforeEach(async () => {
    capturedMainRequest = undefined;

    esSearch = jest.fn((req: any) => {
      if (req.index === 'hybrid_taxonomies') {
        return Promise.resolve(taxonomyResponse);
      }
      capturedMainRequest = req;
      return Promise.resolve(mainResponse);
    });
    esCount = jest.fn().mockResolvedValue({ count: 42 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HybridSearchService,
        {
          provide: ElasticsearchService,
          useValue: { search: esSearch, count: esCount },
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
            getOrSet: jest.fn((_key, factory) => factory()),
          },
        },
      ],
    }).compile();

    service = module.get<HybridSearchService>(HybridSearchService);
    jest.spyOn(service, 'embedQuery').mockResolvedValue([0.1, 0.2, 0.3, 0.4]);
  });

  const baseQuery = {
    query: 'food shelf',
    page: 1,
    limit: 25,
    filters: {},
    distance: 0,
    taxonomy: [] as string[],
  } as any;

  it('runs a single _search (no msearch) with the hybrid scoring shape', async () => {
    await service.searchHybrid({ headers, query: baseQuery });

    // One taxonomy lookup + one main search; never msearch.
    expect(esSearch).toHaveBeenCalledTimes(2);
    expect((service as any).elasticsearchService.msearch).toBeUndefined();

    const bool = capturedMainRequest.query.function_score.query.bool;
    expect(bool.minimum_should_match).toBe(0);
    expect(capturedMainRequest.track_total_hits).toBe(true);
  });

  it('scores the vector via an exact cosineSimilarity script_score', async () => {
    await service.searchHybrid({ headers, query: baseQuery });

    const functions = capturedMainRequest.query.function_score.functions;
    const scriptFn = functions.find((f: any) => f.script_score);
    expect(scriptFn).toBeDefined();
    expect(scriptFn.script_score.script.source).toBe(
      "cosineSimilarity(params.qv, 'embedding') + 1.0",
    );
    expect(scriptFn.weight).toBe(50);
    // No knn clause anywhere on the main request.
    expect(capturedMainRequest.knn).toBeUndefined();
  });

  it('emits one score-weighted constant_score clause per predicted code', async () => {
    await service.searchHybrid({ headers, query: baseQuery });

    const should = capturedMainRequest.query.function_score.query.bool.should;
    const taxonomyClauses = should.filter(
      (c: any) => c.nested?.query?.constant_score,
    );

    expect(taxonomyClauses).toHaveLength(2);

    const codes = taxonomyClauses.map(
      (c: any) => c.nested.query.constant_score.filter.term['taxonomies.code'],
    );
    expect(codes).toEqual(['BH-1800', 'BV-8900']);

    // boost = 10 * score * (1 + 0.5 / (1 + i))
    const boost0 = taxonomyClauses[0].nested.query.constant_score.boost;
    const boost1 = taxonomyClauses[1].nested.query.constant_score.boost;
    expect(boost0).toBeCloseTo(10 * 0.9 * (1 + 0.5 / 1));
    expect(boost1).toBeCloseTo(10 * 0.6 * (1 + 0.5 / 2));

    // Not a single flat terms boost clause.
    const flatTerms = should.filter(
      (c: any) => c.nested?.query?.terms?.['taxonomies.code'],
    );
    expect(flatTerms).toHaveLength(0);
  });

  it('uses a 4-key deterministic sort', async () => {
    await service.searchHybrid({ headers, query: baseQuery });

    expect(capturedMainRequest.sort).toEqual([
      { pinned: 'desc' },
      { priority: 'desc' },
      '_score',
      { service_at_location_id: 'asc' },
    ]);
  });

  it('maps from/size from page and limit (no app-side slicing)', async () => {
    await service.searchHybrid({
      headers,
      query: { ...baseQuery, page: 3, limit: 50 },
    });

    expect(capturedMainRequest.from).toBe(100);
    expect(capturedMainRequest.size).toBe(50);
  });

  it('returns hits.total.value as the full count and ES hits directly', async () => {
    const result = await service.searchHybrid({ headers, query: baseQuery });

    expect(result.search.hits.total).toEqual({ value: 1234, relation: 'eq' });
    expect(result.search.hits.hits).toHaveLength(1);
    expect(result.search.hits.hits[0]._id).toBe('doc-1');
  });

  it('omits lexical should clauses in browse mode (empty query) but keeps taxonomy boosts', async () => {
    await service.searchHybrid({
      headers,
      query: { ...baseQuery, query: '' },
    });

    const should = capturedMainRequest.query.function_score.query.bool.should;
    const hasLexical = should.some(
      (c: any) => c.match_phrase || c.multi_match || c.prefix || c.term,
    );
    expect(hasLexical).toBe(false);

    const taxonomyClauses = should.filter(
      (c: any) => c.nested?.query?.constant_score,
    );
    expect(taxonomyClauses).toHaveLength(2);
  });

  it('adds a hard taxonomy scope filter when the taxonomy param is provided', async () => {
    await service.searchHybrid({
      headers,
      query: { ...baseQuery, taxonomy: ['BM-1400', 'BM-1700'] },
    });

    const filter = capturedMainRequest.query.function_score.query.bool.filter;
    const scope = filter.find(
      (f: any) => f.nested?.query?.terms?.['taxonomies.code'],
    );
    expect(scope).toBeDefined();
    expect(scope.nested.query.terms['taxonomies.code']).toEqual([
      'BM-1400',
      'BM-1700',
    ]);
  });

  describe('getDocumentsCount', () => {
    it('counts by tenant + taxonomy scope only (no query text, no geo)', async () => {
      const count = await service.getDocumentsCount(headers, 'ignored query', [
        'BH-100',
        'BH-200',
      ]);

      expect(count).toBe(42);
      expect(esCount).toHaveBeenCalledTimes(1);

      const req = esCount.mock.calls[0][0];
      expect(req.index).toBe('hybrid_search_resources_en');

      const filter = req.query.bool.filter;
      expect(filter).toContainEqual({ term: { tenant_id: 'tenant-a' } });
      expect(filter).toContainEqual({
        nested: {
          path: 'taxonomies',
          query: { terms: { 'taxonomies.code': ['BH-100', 'BH-200'] } },
        },
      });
      // No geo_distance / geo_shape clauses.
      expect(JSON.stringify(req)).not.toContain('geo_');
    });

    it('returns 0 without calling ES when no taxonomies are provided', async () => {
      const count = await service.getDocumentsCount(headers, 'q', []);
      expect(count).toBe(0);
      expect(esCount).not.toHaveBeenCalled();
    });
  });
});
