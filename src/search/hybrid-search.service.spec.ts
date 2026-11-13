import { Test, TestingModule } from '@nestjs/testing';
import { createMetricsServiceMock } from 'src/metrics/testing/metrics-service.mock';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { HybridSearchService } from './hybrid-search.service';
import { TenantConfigService } from '../cms-config/tenant-config.service';
import { RequestCacheService } from 'src/common/services/cache/request-cache.service';
import { MetricsService } from 'src/metrics/metrics.service';

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
        {
          provide: MetricsService,
          useValue: createMetricsServiceMock(),
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

  // ISS-2755: a decay function scores a document missing the field as 1, so
  // without the filter a listing with no map point got the full distance bonus,
  // as if it sat exactly at the search point.
  it('gives the distance bonus only to documents that have a map point', async () => {
    await service.searchHybrid({
      headers,
      query: { ...baseQuery, coords: [-74.89, 44.93], distance: 25 },
    });

    const functions = capturedMainRequest.query.function_score.functions;
    const geo = functions.filter((fn: any) => fn.gauss);

    expect(geo).toHaveLength(1);
    expect(geo[0].filter).toEqual({ exists: { field: 'location.point' } });
    expect(geo[0].weight).toBe(25);
  });

  // ISS-2755 on every hybrid path: query text (semantic function present),
  // browse and lexical fallback (distance is the only function), and pins.
  describe('results with no map point, every hybrid path (ISS-2755)', () => {
    const COORDS = [-74.89, 44.93];
    const proximity = {
      ...baseQuery,
      coords: COORDS,
      distance: 25,
      geo_type: 'proximity',
    };

    const findLackingCoordinatesBranch = (node: unknown): any => {
      if (node === null || typeof node !== 'object') return undefined;
      const bool = (node as any).bool;
      if (bool?.must_not?.exists?.field === 'location.point') return node;
      for (const child of Object.values(node as object)) {
        const found = findLackingCoordinatesBranch(child);
        if (found) return found;
      }
      return undefined;
    };

    const expectProximityRuleAndGatedGauss = (request: any) => {
      expect(findLackingCoordinatesBranch(request.query)?.bool.filter).toEqual({
        geo_shape: {
          service_area: {
            shape: { type: 'point', coordinates: COORDS },
            relation: 'contains',
          },
        },
      });
      const gauss = request.query.function_score.functions.filter(
        (fn: any) => fn.gauss,
      );
      expect(gauss).toHaveLength(1);
      expect(gauss[0].filter).toEqual({ exists: { field: 'location.point' } });
    };

    // A document that matches no score function scores 1 under boost_mode sum.
    // The semantic and priority functions have no filter, so they match every
    // document; only when neither is present does a no-point result get that 1.
    const functionKinds = () =>
      capturedMainRequest.query.function_score.functions.map((fn: any) =>
        fn.gauss
          ? 'gauss'
          : fn.script_score
            ? 'semantic'
            : fn.field_value_factor?.field === 'priority'
              ? 'priority'
              : 'other',
      );

    const withPinnedMode = (mode: string) => {
      (service as any).tenantConfigService.getSearchConfig = jest
        .fn()
        .mockResolvedValue({ pinned_resources_mode: mode });
    };

    it('query text: semantic function present alongside the gated gauss', async () => {
      await service.searchHybrid({ headers, query: proximity });

      expectProximityRuleAndGatedGauss(capturedMainRequest);
      expect(functionKinds()).toEqual(['semantic', 'gauss', 'priority']);
    });

    it('browse (no query text), default boost mode: priority function still present', async () => {
      await service.searchHybrid({
        headers,
        query: { ...proximity, query: '' },
      });

      expectProximityRuleAndGatedGauss(capturedMainRequest);
      expect(functionKinds()).toEqual(['gauss', 'priority']);
    });

    it('lexical fallback (embedding failed), default boost mode: priority function still present', async () => {
      jest
        .spyOn(service, 'embedQuery')
        .mockRejectedValue(new Error('embedding down'));

      await service.searchHybrid({ headers, query: proximity });

      expectProximityRuleAndGatedGauss(capturedMainRequest);
      expect(functionKinds()).toEqual(['gauss', 'priority']);
    });

    it.each(['top', 'ignore'])(
      'browse in %s mode: the gated gauss is the only function (the +1 case)',
      async (mode) => {
        withPinnedMode(mode);

        await service.searchHybrid({
          headers,
          query: { ...proximity, query: '' },
        });

        expectProximityRuleAndGatedGauss(capturedMainRequest);
        expect(functionKinds()).toEqual(['gauss']);
      },
    );

    it('lexical fallback in top mode: the gated gauss is the only function (the +1 case)', async () => {
      withPinnedMode('top');
      jest
        .spyOn(service, 'embedQuery')
        .mockRejectedValue(new Error('embedding down'));

      await service.searchHybrid({ headers, query: proximity });

      expectProximityRuleAndGatedGauss(capturedMainRequest);
      expect(functionKinds()).toEqual(['gauss']);
    });

    it('pins request', async () => {
      const request: any = await service.buildPinsRequest({
        headers,
        query: { ...proximity, limit: 10000 },
      });

      expectProximityRuleAndGatedGauss(request);
    });
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

  describe('buildPinsRequest', () => {
    const pinsQuery = { query: 'food', page: 1, limit: 10000 } as any;

    it('skips the embedding and taxonomy lookup, keeping the same filters', async () => {
      const embed = jest.spyOn(service, 'embedQuery');

      const request: any = await service.buildPinsRequest({
        headers,
        query: { ...pinsQuery, filters: { language: 'en' } },
      });

      expect(embed).not.toHaveBeenCalled();
      expect(esSearch).not.toHaveBeenCalled();
      expect(request.size).toBe(10000);
      expect(JSON.stringify(request.query)).toContain('"tenant_id":"tenant-a"');
      expect(JSON.stringify(request.query)).not.toContain('cosineSimilarity');
    });

    it('keeps the embedding when relevance_cutoff reads the scores', async () => {
      const embed = jest
        .spyOn(service, 'embedQuery')
        .mockResolvedValue([0.1, 0.2]);

      await service.buildPinsRequest({
        headers,
        query: { ...pinsQuery, relevance_cutoff: 'on' },
      });

      expect(embed).toHaveBeenCalledWith('food');
    });
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

  describe('shard-copy preference', () => {
    const preferencesOf = async (query: any, h: any = headers) => {
      esSearch.mockClear();
      await service.searchHybrid({ headers: h, query });
      return esSearch.mock.calls.map(([req]) => req.preference);
    };

    it('pins the taxonomy lookup and the main search to one preference', async () => {
      const preferences = await preferencesOf(baseQuery);

      expect(preferences).toHaveLength(2);
      expect(preferences[0]).toEqual(expect.any(String));
      // A leading underscore is Elasticsearch's reserved preference syntax.
      expect(preferences[0]).not.toMatch(/^_/);
      expect(new Set(preferences).size).toBe(1);
    });

    it('keeps the same preference for every page, limit and sort of a search', async () => {
      const preferences = [
        ...(await preferencesOf(baseQuery)),
        ...(await preferencesOf({ ...baseQuery, page: 4, limit: 10 })),
        ...(await preferencesOf({ ...baseQuery, sort: 'name' })),
      ];

      // Every search of all three requests, not just the first of each.
      expect(preferences).toHaveLength(6);
      expect(preferences[0]).toEqual(expect.any(String));
      expect(new Set(preferences).size).toBe(1);
    });

    it('uses a different preference for a different search', async () => {
      const [base] = await preferencesOf(baseQuery);
      const [otherText] = await preferencesOf({ ...baseQuery, query: 'rent' });
      const [otherTenant] = await preferencesOf(baseQuery, {
        ...headers,
        'x-tenant-id': 'tenant-b',
      });
      const [otherScope] = await preferencesOf({
        ...baseQuery,
        taxonomy: ['BM-1400'],
      });

      expect(new Set([base, otherText, otherTenant, otherScope]).size).toBe(4);
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

  it('excludes SUNE enrichment fields from _source in the request (ISS-2754)', async () => {
    await service.searchHybrid({ headers, query: baseQuery });

    const excludes = capturedMainRequest._source.excludes;
    expect(excludes).toEqual(
      expect.arrayContaining([
        'sune_needs',
        'sune_need_weights',
        'sune_scorecard_version',
      ]),
    );
  });

  it('never returns SUNE enrichment fields even if ES sends them (ISS-2754)', async () => {
    esSearch.mockImplementation((req: any) => {
      if (req.index === 'hybrid_taxonomies') {
        return Promise.resolve(taxonomyResponse);
      }
      return Promise.resolve({
        ...mainResponse,
        hits: {
          ...mainResponse.hits,
          hits: [
            {
              _index: 'hybrid_search_resources_en',
              _id: 'doc-1',
              _score: 42,
              _source: {
                name: 'Shelter',
                facets: {},
                facets_en: {},
                sune_needs: ['N-HOU'],
                sune_need_weights: { 'N-HOU': 0.8 },
                sune_scorecard_version: 'v1',
              },
            },
          ],
        },
      });
    });

    const result = await service.searchHybrid({ headers, query: baseQuery });
    const source = result.search.hits.hits[0]._source as any;

    expect(source.name).toBe('Shelter');
    expect(source).not.toHaveProperty('sune_needs');
    expect(source).not.toHaveProperty('sune_need_weights');
    expect(source).not.toHaveProperty('sune_scorecard_version');
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
