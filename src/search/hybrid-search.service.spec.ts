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
      "Math.max(0, cosineSimilarity(params.qv, 'embedding'))",
    );
    expect(scriptFn.weight).toBe(100);
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

    // boost = 50 * score * (1 + 0.5 / (1 + i))
    const boost0 = taxonomyClauses[0].nested.query.constant_score.boost;
    const boost1 = taxonomyClauses[1].nested.query.constant_score.boost;
    expect(boost0).toBeCloseTo(50 * 0.9 * (1 + 0.5 / 1));
    expect(boost1).toBeCloseTo(50 * 0.6 * (1 + 0.5 / 2));

    // Not a single flat terms boost clause.
    const flatTerms = should.filter(
      (c: any) => c.nested?.query?.terms?.['taxonomies.code'],
    );
    expect(flatTerms).toHaveLength(0);
  });

  it('keeps the x1 taxonomy boost baseline for short queries', async () => {
    // 'food shelf' = 2 tokens: at or below the per-unit length, the boost is
    // exactly the flat baseline the ranking was tuned on.
    await service.searchHybrid({ headers, query: baseQuery });

    const should = capturedMainRequest.query.function_score.query.bool.should;
    const boost = should.find((c: any) => c.nested?.query?.constant_score)
      .nested.query.constant_score.boost;
    expect(boost).toBeCloseTo(50 * 0.9 * (1 + 0.5 / 1));
  });

  it('scales taxonomy boosts up with query length', async () => {
    // 6 tokens → floor(6/3) = 2: the recall clause's BM25 doubles with the
    // token count, so the intent signal scales with it.
    const long = {
      ...baseQuery,
      query: 'help paying rent after losing my job',
    };
    await service.searchHybrid({ headers, query: long });

    const should = capturedMainRequest.query.function_score.query.bool.should;
    const boost = should.find((c: any) => c.nested?.query?.constant_score)
      .nested.query.constant_score.boost;
    expect(boost).toBeCloseTo(50 * 2 * 0.9 * (1 + 0.5 / 1));
  });

  it('caps the taxonomy boost length scale', async () => {
    // 15 tokens → floor(15/3) = 5, exactly the cap.
    const veryLong = {
      ...baseQuery,
      query:
        'need to know what steps to do when someone dies at home in the family',
    };
    await service.searchHybrid({ headers, query: veryLong });

    const should = capturedMainRequest.query.function_score.query.bool.should;
    const boost = should.find((c: any) => c.nested?.query?.constant_score)
      .nested.query.constant_score.boost;
    expect(boost).toBeCloseTo(50 * 5 * 0.9 * (1 + 0.5 / 1));
  });

  it('uses a 2-key deterministic sort by default (boost mode)', async () => {
    await service.searchHybrid({ headers, query: baseQuery });

    expect(capturedMainRequest.sort).toEqual([
      '_score',
      { service_at_location_id: { order: 'asc' } },
    ]);
  });

  describe('sort param (ISS-1367)', () => {
    it('honors sort=distance by emitting a _geo_distance tier when coords are present', async () => {
      await service.searchHybrid({
        headers,
        query: { ...baseQuery, sort: 'distance', coords: [-76.6122, 39.2904] },
      });

      expect(capturedMainRequest.sort).toEqual([
        {
          _geo_distance: {
            'location.point': { lon: -76.6122, lat: 39.2904 },
            order: 'asc',
            unit: 'm',
            mode: 'min',
          },
        },
        { service_at_location_id: { order: 'asc' } },
      ]);
    });

    it('falls back to _score for sort=distance when no coords are provided', async () => {
      await service.searchHybrid({
        headers,
        query: { ...baseQuery, sort: 'distance' },
      });

      expect(capturedMainRequest.sort).toEqual([
        '_score',
        { service_at_location_id: { order: 'asc' } },
      ]);
    });

    it('honors sort=name with a case-insensitive alphabetical tier on the hybrid-index .lc field', async () => {
      await service.searchHybrid({
        headers,
        query: { ...baseQuery, sort: 'name' },
      });

      expect(capturedMainRequest.sort).toEqual([
        { 'name.lc': { order: 'asc' } },
        { service_at_location_id: { order: 'asc' } },
      ]);
    });

    it('honors sort=organization with provider-then-name .lc tiers', async () => {
      await service.searchHybrid({
        headers,
        query: { ...baseQuery, sort: 'organization' },
      });

      expect(capturedMainRequest.sort).toEqual([
        { 'organization.name.lc': { order: 'asc' } },
        { 'name.lc': { order: 'asc' } },
        { service_at_location_id: { order: 'asc' } },
      ]);
    });

    it('defaults to boost mode when pinned_resources_mode is missing', async () => {
      (service as any).tenantConfigService.getSearchConfig = jest
        .fn()
        .mockResolvedValue({});

      await service.searchHybrid({
        headers,
        query: { ...baseQuery, sort: 'distance', coords: [-76.6122, 39.2904] },
      });

      const functions = capturedMainRequest.query.function_score.functions;
      expect(capturedMainRequest.sort).toEqual([
        {
          _geo_distance: {
            'location.point': { lon: -76.6122, lat: 39.2904 },
            order: 'asc',
            unit: 'm',
            mode: 'min',
          },
        },
        { service_at_location_id: { order: 'asc' } },
      ]);
      expect(
        functions.some((f: any) => f.field_value_factor?.field === 'priority'),
      ).toBe(true);
      const should = capturedMainRequest.query.function_score.query.bool.should;
      expect(
        should.some(
          (c: any) => c.constant_score?.filter?.term?.pinned === true,
        ),
      ).toBe(true);
    });

    it('boost mode drops pinned/priority tiers and adds score contributions', async () => {
      (service as any).tenantConfigService.getSearchConfig = jest
        .fn()
        .mockResolvedValue({ pinned_resources_mode: 'boost' });

      await service.searchHybrid({
        headers,
        query: { ...baseQuery, sort: 'distance', coords: [-76.6122, 39.2904] },
      });

      const functions = capturedMainRequest.query.function_score.functions;
      const should = capturedMainRequest.query.function_score.query.bool.should;

      expect(capturedMainRequest.sort).toEqual([
        {
          _geo_distance: {
            'location.point': { lon: -76.6122, lat: 39.2904 },
            order: 'asc',
            unit: 'm',
            mode: 'min',
          },
        },
        { service_at_location_id: { order: 'asc' } },
      ]);
      expect(
        functions.some((f: any) => f.field_value_factor?.field === 'priority'),
      ).toBe(true);
      expect(
        should.some(
          (c: any) => c.constant_score?.filter?.term?.pinned === true,
        ),
      ).toBe(true);
    });

    it('top mode hard-sorts pinned/priority resources and omits score contributions', async () => {
      (service as any).tenantConfigService.getSearchConfig = jest
        .fn()
        .mockResolvedValue({ pinned_resources_mode: 'top' });

      await service.searchHybrid({
        headers,
        query: { ...baseQuery, sort: 'distance', coords: [-76.6122, 39.2904] },
      });

      const functions = capturedMainRequest.query.function_score.functions;
      const should = capturedMainRequest.query.function_score.query.bool.should;

      expect(capturedMainRequest.sort).toEqual([
        { pinned: 'desc' },
        { priority: 'desc' },
        {
          _geo_distance: {
            'location.point': { lon: -76.6122, lat: 39.2904 },
            order: 'asc',
            unit: 'm',
            mode: 'min',
          },
        },
        { service_at_location_id: { order: 'asc' } },
      ]);
      expect(
        functions.some((f: any) => f.field_value_factor?.field === 'priority'),
      ).toBe(false);
      expect(
        should.some(
          (c: any) => c.constant_score?.filter?.term?.pinned === true,
        ),
      ).toBe(false);
    });

    it('ignore mode omits pinned/priority tiers and score contributions', async () => {
      (service as any).tenantConfigService.getSearchConfig = jest
        .fn()
        .mockResolvedValue({ pinned_resources_mode: 'ignore' });

      await service.searchHybrid({
        headers,
        query: { ...baseQuery, sort: 'distance', coords: [-76.6122, 39.2904] },
      });

      const functions = capturedMainRequest.query.function_score.functions;
      const should = capturedMainRequest.query.function_score.query.bool.should;

      expect(capturedMainRequest.sort).toEqual([
        {
          _geo_distance: {
            'location.point': { lon: -76.6122, lat: 39.2904 },
            order: 'asc',
            unit: 'm',
            mode: 'min',
          },
        },
        { service_at_location_id: { order: 'asc' } },
      ]);
      expect(
        functions.some((f: any) => f.field_value_factor?.field === 'priority'),
      ).toBe(false);
      expect(
        should.some(
          (c: any) => c.constant_score?.filter?.term?.pinned === true,
        ),
      ).toBe(false);
    });
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

  it('omits lexical and taxonomy boost clauses in browse mode (empty query)', async () => {
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
    expect(taxonomyClauses).toHaveLength(0);
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

  // Same guard on the hybrid path. Only the recall clauses get a fallback:
  // the name tiers are phrase/prefix by design and the use_references clause is
  // curated, where an approximate match defeats the curation.
  it('pairs each recall clause with a de-boosted fuzzy fallback', async () => {
    await service.searchHybrid({ headers, query: baseQuery });

    const should = capturedMainRequest.query.function_score.query.bool.should;
    const all = [
      ...should
        .filter((c: any) => c.multi_match)
        .map((c: any) => c.multi_match),
      ...should
        .filter((c: any) => c.nested?.query?.multi_match)
        .map((c: any) => c.nested.query.multi_match),
    ];
    const fuzzy = all.filter((m: any) => m.fuzziness === 'AUTO');
    const exact = all.filter((m: any) => m.fuzziness === undefined);

    expect(exact.length).toBeGreaterThan(0);
    expect(fuzzy.length).toBe(exact.length);
    for (const m of fuzzy) {
      expect(m.prefix_length).toBe(2);
      expect(m.boost).toBe(0.01);
    }
  });
});
