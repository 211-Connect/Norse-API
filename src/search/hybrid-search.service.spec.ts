import { Test, TestingModule } from '@nestjs/testing';
import { createMetricsServiceMock } from 'src/metrics/testing/metrics-service.mock';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import {
  HybridSearchService,
  VIRTUAL_DISTANCE_IN_SCALES,
  virtualDistanceWeight,
  parseKeywordLocales,
} from './hybrid-search.service';
import { TenantConfigService } from '../cms-config/tenant-config.service';
import { SearchUtilsService } from './search-utils.service';
import { BoundedKeyRegistry } from './internal/cache-key/bounded-key-registry';
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
  let esExistsAlias: jest.Mock;
  let capturedMainRequest: any;
  let rarityRequests: any[];
  let rarityImpl: (req: any) => Promise<any>;
  // In-memory stand-in for the per-word rarity cache (getMany / setMany).
  let cacheStore: Map<string, unknown>;
  let cacheGetMany: (keys: string[]) => Promise<unknown[]>;
  let cacheSetMany: (entries: Record<string, unknown>) => Promise<void>;

  // Default: every word appears in 5 of 1000 docs.
  const defaultRarityResponse = (req: any) => ({
    hits: { total: { value: 1000, relation: 'eq' }, hits: [] },
    aggregations: {
      df: {
        buckets: Object.fromEntries(
          Object.keys(req.aggs.df.filters.filters).map((k) => [
            k,
            { doc_count: 5 },
          ]),
        ),
      },
    },
  });

  beforeEach(async () => {
    capturedMainRequest = undefined;
    rarityRequests = [];
    rarityImpl = (req) => Promise.resolve(defaultRarityResponse(req));
    cacheStore = new Map();
    cacheGetMany = (keys) =>
      Promise.resolve(keys.map((k) => cacheStore.get(k)));
    cacheSetMany = (entries) => {
      Object.entries(entries).forEach(([k, v]) => cacheStore.set(k, v));
      return Promise.resolve();
    };

    esSearch = jest.fn((req: any) => {
      if (req.index === 'hybrid_taxonomies') {
        return Promise.resolve(taxonomyResponse);
      }
      if (req.size === 0 && req.aggs?.df) {
        rarityRequests.push(req);
        return rarityImpl(req);
      }
      // Every ranked list fails, so a v2 text search keeps the summed request
      // these specs read. The fused path has its own spec (rrf.spec.ts).
      if (req._source === false && req.size === 100) {
        return Promise.reject(new Error('lists off in this spec'));
      }
      capturedMainRequest = req;
      return Promise.resolve(mainResponse);
    });
    esCount = jest.fn().mockResolvedValue({ count: 42 });
    // Default: no per-tenant hybrid alias, so searches read the shared name.
    esExistsAlias = jest.fn().mockResolvedValue(false);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HybridSearchService,
        {
          provide: ElasticsearchService,
          useValue: {
            search: esSearch,
            count: esCount,
            indices: { existsAlias: esExistsAlias },
          },
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
            getMany: jest.fn((keys: string[]) => cacheGetMany(keys)),
            setMany: jest.fn((entries: Record<string, unknown>) =>
              cacheSetMany(entries),
            ),
            deleteMany: jest.fn((keys: string[]) => {
              keys.forEach((k) => cacheStore.delete(k));
              return Promise.resolve();
            }),
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

    // v1: one taxonomy lookup + one main search; never msearch.
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

  // Lucas, 2026-11-18: in v2 a service with no map point (virtual, hotline)
  // scores as if it sat at the scale distance. v1 keeps 0.
  describe('v2 virtual distance: no-point services score as a fixed distance', () => {
    const COORDS = [-122.33, 47.61];
    const mainFunctions = () =>
      (capturedMainRequest.query.pinned?.organic ?? capturedMainRequest.query)
        .function_score.functions;
    const virtualFns = () =>
      mainFunctions().filter(
        (fn: any) =>
          fn.filter?.bool?.must_not?.[0]?.exists?.field === 'location.point',
      );

    it('weight is the gauss value of a service one scale away (12.5)', () => {
      expect(VIRTUAL_DISTANCE_IN_SCALES).toBe(1);
      expect(virtualDistanceWeight()).toBeCloseTo(12.5, 6);
    });

    it.each([
      [0, 5],
      [10, 10],
      [25, 25],
    ])(
      'v2, distance %p: one flat function on no-point services, scale %p mi',
      async (distance, scaleMi) => {
        await service.searchHybrid({
          headers,
          query: { ...baseQuery, coords: COORDS, distance },
          rankingVersion: 'v2',
        });

        const fns = virtualFns();
        expect(fns).toHaveLength(1);
        expect(fns[0]).toEqual({
          filter: {
            bool: { must_not: [{ exists: { field: 'location.point' } }] },
          },
          weight: 12.5,
        });
        // The gauss on services with a point is unchanged.
        const gauss = mainFunctions().filter((fn: any) => fn.gauss);
        expect(gauss).toHaveLength(1);
        expect(gauss[0].weight).toBe(25);
        expect(gauss[0].gauss['location.point'].scale).toBe(`${scaleMi}mi`);
      },
    );

    it('v1 with coords: no virtual function (unchanged)', async () => {
      await service.searchHybrid({
        headers,
        query: { ...baseQuery, coords: COORDS, distance: 10 },
      });

      expect(virtualFns()).toHaveLength(0);
      expect(mainFunctions().filter((fn: any) => fn.gauss)).toHaveLength(1);
    });

    it('v2 without coords: no virtual function', async () => {
      await service.searchHybrid({
        headers,
        query: baseQuery,
        rankingVersion: 'v2',
      });

      expect(virtualFns()).toHaveLength(0);
    });

    it('v2 sort=distance keeps the distance sort (no-point services last)', async () => {
      await service.searchHybrid({
        headers,
        query: { ...baseQuery, coords: COORDS, distance: 10, sort: 'distance' },
        rankingVersion: 'v2',
      });

      const geoSort = capturedMainRequest.sort.find(
        (s: any) => s._geo_distance,
      );
      expect(geoSort).toBeDefined();
    });

    describe('v2 sort=distance hides services with no map point', () => {
      const mainFilters = (): any[] =>
        (capturedMainRequest.query.pinned?.organic ?? capturedMainRequest.query)
          .function_score.query.bool.filter;
      const hasPointFilter = () =>
        mainFilters().some((f: any) => f.exists?.field === 'location.point');
      const area = {
        regionIds: ['region-1'],
        match: 'located_or_serving',
        unlocated: 'virtual',
      } as any;

      it('v2, coords: requires a map point and sorts by distance', async () => {
        await service.searchHybrid({
          headers,
          query: { ...baseQuery, coords: COORDS, sort: 'distance' },
          rankingVersion: 'v2',
        });

        expect(hasPointFilter()).toBe(true);
        expect(
          capturedMainRequest.sort.find((s: any) => s._geo_distance),
        ).toBeDefined();
      });

      it('v2 area search, coords: still hides virtual services', async () => {
        await service.searchHybrid({
          headers,
          query: { ...baseQuery, coords: COORDS, sort: 'distance' },
          rankingVersion: 'v2',
          area,
        } as any);

        expect(hasPointFilter()).toBe(true);
      });

      it('v2 area search, no coords: sorts by relevance, hides nothing', async () => {
        await service.searchHybrid({
          headers,
          query: { ...baseQuery, sort: 'distance' },
          rankingVersion: 'v2',
          area,
        } as any);

        expect(hasPointFilter()).toBe(false);
        expect(capturedMainRequest.sort[0]).toBe('_score');
      });

      it('v2, no coords: hides nothing', async () => {
        await service.searchHybrid({
          headers,
          query: { ...baseQuery, sort: 'distance' },
          rankingVersion: 'v2',
        });

        expect(hasPointFilter()).toBe(false);
      });

      it.each(['name', 'organization', 'relevance'] as const)(
        'v2, coords, sort=%s: no map-point filter',
        async (sort) => {
          await service.searchHybrid({
            headers,
            query: { ...baseQuery, coords: COORDS, sort },
            rankingVersion: 'v2',
          });

          expect(hasPointFilter()).toBe(false);
        },
      );

      describe('strict ascending distance, with and without selected needs', () => {
        const ORIGIN = { lat: 47.61, lon: -122.33 };
        const points = [
          { id: 'far', lat: 47.9, lon: -122.0 },
          { id: 'near', lat: 47.62, lon: -122.32 },
          { id: 'mid', lat: 47.7, lon: -122.2 },
        ];
        const miles = (p: { lat: number; lon: number }) =>
          SearchUtilsService.haversineDistanceMiles(
            ORIGIN.lat,
            ORIGIN.lon,
            p.lat,
            p.lon,
          );

        // Stand-in for Elasticsearch: honours the request's sort tiers.
        // A _script tier (the need block) would lead, as in production.
        const useSortingEs = (selected: string[]) => {
          esSearch.mockImplementation((req: any) => {
            if (req.index === 'hybrid_taxonomies') {
              return Promise.resolve(taxonomyResponse);
            }
            if (req.size === 0 && req.aggs?.df) {
              rarityRequests.push(req);
              return rarityImpl(req);
            }
            capturedMainRequest = req;
            const hasBlock = req.sort.some((s: any) => s._script);
            const rows = points.map((p, i) => ({
              _index: 'hybrid_search_resources_en',
              _id: p.id,
              _score: 1,
              _source: { name: p.id, facets: {}, facets_en: {} },
              // 'far' has every selected need, 'near' none.
              block: p.id === 'far' ? 2 : p.id === 'mid' ? 1 : 0,
              dist: miles(p),
              i,
            }));
            rows.sort((a, b) =>
              hasBlock && selected.length > 0
                ? b.block - a.block || a.dist - b.dist
                : a.dist - b.dist,
            );
            return Promise.resolve({
              ...mainResponse,
              hits: {
                ...mainResponse.hits,
                hits: rows.map((r) => ({
                  _index: r._index,
                  _id: r._id,
                  _score: r._score,
                  _source: r._source,
                  sort: hasBlock ? [r.block, r.dist, r._id] : [r.dist, r._id],
                  fields: { matched_needs: [] },
                })),
              },
            });
          });
        };

        it.each([[[]], [['N-A', 'N-B']]] as [string[]][])(
          'selectedNeeds=%j: no need-block tier, geo sort first, ids ascending by haversine',
          async (selectedNeeds) => {
            useSortingEs(selectedNeeds);
            const out: any = await service.searchHybrid({
              headers,
              query: {
                ...baseQuery,
                coords: [ORIGIN.lon, ORIGIN.lat],
                sort: 'distance',
              },
              rankingVersion: 'v2',
              selectedNeeds,
            } as any);

            const sort = capturedMainRequest.sort;
            expect(sort.some((s: any) => s._script)).toBe(false);
            expect(sort[0]._geo_distance).toBeDefined();

            const res = out.search;
            const ids = res.hits.hits.map((h: any) => h._id);
            const expected = [...points]
              .sort((a, b) => miles(a) - miles(b))
              .map((p) => p.id);
            expect(ids).toEqual(expected);
            // Returned sort values are the distance first, not the block number.
            expect(res.hits.hits[0].sort[0]).toBeCloseTo(miles(points[1]), 6);
          },
        );

        it('selectedNeeds with sort=relevance still lead as a block tier', async () => {
          useSortingEs(['N-A']);
          await service.searchHybrid({
            headers,
            query: {
              ...baseQuery,
              coords: [ORIGIN.lon, ORIGIN.lat],
              sort: 'relevance',
            },
            rankingVersion: 'v2',
            selectedNeeds: ['N-A'],
          } as any);

          expect(capturedMainRequest.sort[0]._script).toBeDefined();
        });
      });

      it('v1, coords, sort=distance: unchanged, no map-point filter', async () => {
        await service.searchHybrid({
          headers,
          query: { ...baseQuery, coords: COORDS, sort: 'distance' },
        });

        expect(hasPointFilter()).toBe(false);
      });
    });
  });

  it("v2 taxonomy lookup uses exact cosine over the tenant's codes (ISS-2692)", async () => {
    await service.searchHybrid({
      headers,
      query: baseQuery,
      rankingVersion: 'v2',
    });

    const taxonomyCall = esSearch.mock.calls
      .map((c) => c[0])
      .find((req) => req.index === 'hybrid_taxonomies');
    expect(taxonomyCall).toBeDefined();
    expect(taxonomyCall.knn).toBeUndefined();
    const scoreQuery = taxonomyCall.query.script_score;
    expect(scoreQuery.query).toEqual({ term: { tenant_id: 'tenant-a' } });
    expect(scoreQuery.script.source).toContain(
      "cosineSimilarity(params.qv, 'embedding')",
    );
    expect(scoreQuery.script.params.qv).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(taxonomyCall.size).toBe(10);
  });

  it('uses a provided queryVector and does not embed again', async () => {
    const embed = service.embedQuery as jest.Mock;
    embed.mockClear();
    const vector = [0.5, 0.6, 0.7, 0.8];
    await service.searchHybrid({
      headers,
      query: baseQuery,
      rankingVersion: 'v2',
      queryVector: Promise.resolve(vector),
    });

    expect(embed).not.toHaveBeenCalled();
    const taxonomyCall = esSearch.mock.calls
      .map((c) => c[0])
      .find((req) => req.index === 'hybrid_taxonomies');
    expect(taxonomyCall.query.script_score.script.params.qv).toEqual(vector);
    // v2 relevance searches wrap the main query in rank fusion's `pinned`.
    const mainQuery =
      capturedMainRequest.query.pinned?.organic ?? capturedMainRequest.query;
    const scriptFn = mainQuery.function_score.functions.find(
      (f: any) => f.script_score,
    );
    expect(scriptFn.script_score.script.params.qv).toEqual(vector);
  });

  it('a provided queryVector that resolves undefined gives the lexical-only request', async () => {
    const embed = service.embedQuery as jest.Mock;
    embed.mockClear();
    await service.searchHybrid({
      headers,
      query: baseQuery,
      rankingVersion: 'v2',
      queryVector: Promise.resolve(undefined),
    });

    expect(embed).not.toHaveBeenCalled();
    const taxonomyCall = esSearch.mock.calls
      .map((c) => c[0])
      .find((req) => req.index === 'hybrid_taxonomies');
    expect(taxonomyCall).toBeUndefined();
    // v2 with a query has no pinned priority function (pinned gate), so a
    // lexical-only main query can be a plain bool with no function_score.
    const functions = capturedMainRequest.query.function_score?.functions ?? [];
    expect(functions.find((f: any) => f.script_score)).toBeUndefined();
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

    it('v2 pins match taxonomy child codes; v1 pins match the exact code only', async () => {
      const v1: any = await service.buildPinsRequest({
        headers,
        query: { ...pinsQuery, taxonomy: ['BH-1800'] },
      });
      const v2: any = await service.buildPinsRequest({
        headers,
        query: { ...pinsQuery, taxonomy: ['BH-1800'] },
        rankingVersion: 'v2',
      });

      expect(JSON.stringify(v1.query)).toContain(
        '"terms":{"taxonomies.code":["BH-1800"]}',
      );
      expect(JSON.stringify(v1.query)).not.toContain(
        '"prefix":{"taxonomies.code"',
      );
      expect(JSON.stringify(v2.query)).toContain(
        '"prefix":{"taxonomies.code":"BH-1800."}',
      );
      expect(JSON.stringify(v2.query)).toContain(
        '"prefix":{"taxonomies.code":"BH-1800-"}',
      );
    });

    it('v2 pins with text embed the query (the kept set); an empty query skips the embedding', async () => {
      const embed = jest
        .spyOn(service, 'embedQuery')
        .mockResolvedValue([0.1, 0.2]);
      await service.buildPinsRequest({
        headers,
        query: { ...pinsQuery, query: '' },
        rankingVersion: 'v2',
      });
      expect(embed).not.toHaveBeenCalled();

      await service.buildPinsRequest({
        headers,
        query: pinsQuery,
        rankingVersion: 'v2',
      });
      expect(embed).toHaveBeenCalledWith('food');
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
      await service.searchHybrid({
        headers: h,
        query,
        rankingVersion: 'v2',
      });
      return esSearch.mock.calls.map(([req]) => req.preference);
    };

    it('pins the taxonomy lookup, the rarity lookup and the main search to one preference', async () => {
      const preferences = await preferencesOf(baseQuery);

      // taxonomy, rarity, three rank-fusion lists, pinned gate, main search
      expect(preferences).toHaveLength(7);
      expect(preferences[0]).toEqual(expect.any(String));
      // A leading underscore is Elasticsearch's reserved preference syntax.
      expect(preferences[0]).not.toMatch(/^_/);
      expect(new Set(preferences).size).toBe(1);
    });

    it('keeps the same preference for every page, limit and sort of a search', async () => {
      // The rarity words are cached after the first request; clear between
      // requests so every request still sends its own rarity probe.
      const preferences = [
        ...(await preferencesOf(baseQuery)),
        ...(cacheStore.clear(),
        await preferencesOf({ ...baseQuery, page: 4, limit: 10 })),
        ...(cacheStore.clear(),
        await preferencesOf({ ...baseQuery, sort: 'name' })),
      ];

      // Every search of all three requests, not just the first of each. Every
      // sort adds three rank-fusion lists; the relevance sorts add a pinned
      // gate request each (7 + 7 + 6).
      expect(preferences).toHaveLength(20);
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

  describe('V2_KEYWORD_LOCALES switch (keyword leg per locale, v2 only)', () => {
    const isKeywordList = (req: any) =>
      req.query?.bool?.minimum_should_match === 1 &&
      Array.isArray(req.query?.bool?.should);
    const isVectorList = (req: any) => !!req.query?.script_score;
    const mainHasLexical = () =>
      JSON.stringify(capturedMainRequest.query).includes('name.edge');

    const run = async (lang: string, extra: any = {}, v2 = true) => {
      esSearch.mockClear();
      cacheStore.clear();
      await service.searchHybrid({
        headers: { ...headers, 'accept-language': lang },
        query: { ...baseQuery, ...extra },
        ...(v2 ? { rankingVersion: 'v2' as const } : {}),
      });
      return esSearch.mock.calls.map(([r]) => r);
    };

    it('unset: fused v2 search runs the keyword and the vector list for every locale', async () => {
      for (const lang of ['en', 'vi']) {
        const calls = await run(lang);
        expect(calls.some(isKeywordList)).toBe(true);
        expect(calls.some(isVectorList)).toBe(true);
      }
    });

    it('parseKeywordLocales: a malformed entry is ignored; no valid entry means all', () => {
      expect([...parseKeywordLocales('en es, fr')!]).toEqual(['fr']);
      expect(parseKeywordLocales('en es;ru')).toBeNull();
    });

    it('parseKeywordLocales: unset or blank means all locales', () => {
      expect(parseKeywordLocales(undefined)).toBeNull();
      expect(parseKeywordLocales('  , ')).toBeNull();
      expect([...parseKeywordLocales('en, ES')!]).toEqual(['en', 'es']);
    });

    it('a full tag matches before the primary subtag (zh-hans, es-MX)', () => {
      (service as any).keywordLocales = parseKeywordLocales('zh-hans,es');
      const on = (l: string) => (service as any).keywordEnabledForLocale(l);
      expect(on('zh-hans')).toBe(true);
      expect(on('ZH_Hans')).toBe(true);
      expect(on('es-MX')).toBe(true);
      expect(on('zh-hant')).toBe(false);
      expect(on('ru')).toBe(false);
    });

    describe('set to en,es,ru', () => {
      beforeEach(() => {
        (service as any).keywordLocales = parseKeywordLocales('en, ES ,ru');
      });

      it('keeps the keyword leg for listed locales, including a regional tag', async () => {
        for (const lang of ['en', 'es', 'ru', 'es-MX']) {
          const calls = await run(lang);
          expect(calls.some(isKeywordList)).toBe(true);
        }
      });

      it('drops the keyword list for other locales and keeps the vector list', async () => {
        for (const lang of ['vi', 'am']) {
          const calls = await run(lang);
          expect(calls.some(isKeywordList)).toBe(false);
          expect(calls.some(isVectorList)).toBe(true);
        }
      });

      it('summed path (coords given): lexical clauses are gone for vi, present for en', async () => {
        await run('en', { coords: [-122.3, 47.6] });
        expect(mainHasLexical()).toBe(true);
        await run('vi', { coords: [-122.3, 47.6] });
        expect(mainHasLexical()).toBe(false);
      });

      it('embedding failed for vi: the keyword leg runs after all', async () => {
        jest
          .spyOn(service, 'embedQuery')
          .mockRejectedValue(new Error('embedding down'));
        await run('vi', { coords: [-122.3, 47.6] });
        expect(mainHasLexical()).toBe(true);
      });

      it('embedding failed for vi on the fused path (no coords): the keyword list runs after all', async () => {
        jest
          .spyOn(service, 'embedQuery')
          .mockRejectedValue(new Error('embedding down'));
        const calls = await run('vi');
        expect(calls.some(isKeywordList)).toBe(true);
        expect(calls.some(isVectorList)).toBe(false);
      });

      it('returns no weak-match judges when the keyword leg is off', async () => {
        // The ranked lists are off in this spec (see the esSearch mock), so
        // the fused order is stubbed with judges; the gate under test is the
        // keyword leg switch.
        jest.spyOn(service as any, 'fetchFusedOrder').mockResolvedValue({
          ids: undefined,
          judges: { keyword_top: 1, vector_top: 1 },
        });
        const off = await service.searchHybrid({
          headers: { ...headers, 'accept-language': 'vi' },
          query: { ...baseQuery },
          rankingVersion: 'v2' as const,
        });
        expect(off.judges).toBeUndefined();
        (service as any).keywordLocales = null;
        cacheStore.clear();
        const on = await service.searchHybrid({
          headers: { ...headers, 'accept-language': 'vi' },
          query: { ...baseQuery },
          rankingVersion: 'v2' as const,
        });
        expect(on.judges).toBeDefined();
      });

      it('v1 is unchanged: keyword stays on for vi without rankingVersion', async () => {
        await run('vi', {}, false);
        expect(mainHasLexical()).toBe(true);
      });
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
        'taxonomies.use_references',
        'taxonomies.see_also_references',
      ]),
    );
    expect(excludes).not.toContain('taxonomies.description');
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

  // Dagster publishes a tenant by pointing `{tenant}-hybrid_search_resources_{lang}`
  // at the tenant's complete temp index while it rewrites the shared index. Reading
  // the shared name directly sees that rewrite half done: services missing for
  // minutes, or listed twice.
  describe('index resolution', () => {
    it('searches the tenant alias when it exists', async () => {
      esExistsAlias.mockResolvedValue(true);

      await service.searchHybrid({ headers, query: baseQuery });

      expect(esExistsAlias).toHaveBeenCalledWith({
        name: 'tenant-a-hybrid_search_resources_en',
      });
      expect(capturedMainRequest.index).toBe(
        'tenant-a-hybrid_search_resources_en',
      );
    });

    it('counts through the tenant alias when it exists', async () => {
      esExistsAlias.mockResolvedValue(true);

      await service.getDocumentsCount(headers, 'q', ['BH-100']);

      expect(esCount.mock.calls[0][0].index).toBe(
        'tenant-a-hybrid_search_resources_en',
      );
    });

    it('falls back to the shared name when the tenant has no alias', async () => {
      await service.searchHybrid({ headers, query: baseQuery });

      expect(capturedMainRequest.index).toBe('hybrid_search_resources_en');
    });

    it('searches the shared name when the alias check fails', async () => {
      esExistsAlias.mockRejectedValue(new Error('security_exception'));

      await service.searchHybrid({ headers, query: baseQuery });

      expect(capturedMainRequest.index).toBe('hybrid_search_resources_en');
    });

    it('counts through the shared name when the alias check fails', async () => {
      esExistsAlias.mockRejectedValue(new Error('security_exception'));

      const count = await service.getDocumentsCount(headers, 'q', ['BH-100']);

      expect(count).toBe(42);
      expect(esCount.mock.calls[0][0].index).toBe('hybrid_search_resources_en');
    });

    it('does not cache a failed alias check', async () => {
      // A cache that keeps successes and, like RequestCacheService, drops failures.
      const store = new Map<string, unknown>();
      const cache = (service as any).requestCacheService;
      cache.getOrSet.mockImplementation(
        async (key: string, factory: () => Promise<unknown>) => {
          if (store.has(key)) return store.get(key);
          const value = await factory();
          store.set(key, value);
          return value;
        },
      );
      esExistsAlias
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce(true);

      await service.searchHybrid({ headers, query: baseQuery });
      expect(capturedMainRequest.index).toBe('hybrid_search_resources_en');

      await service.searchHybrid({ headers, query: baseQuery });
      expect(capturedMainRequest.index).toBe(
        'tenant-a-hybrid_search_resources_en',
      );
    });

    it('serves a cached count without checking the alias', async () => {
      const cache = (service as any).requestCacheService;
      cache.getOrSet.mockImplementation(
        (key: string, factory: () => Promise<unknown>) =>
          key.startsWith('hybrid_alias_exists:')
            ? factory()
            : Promise.resolve(7),
      );

      const count = await service.getDocumentsCount(headers, 'q', ['BH-100']);

      expect(count).toBe(7);
      expect(esExistsAlias).not.toHaveBeenCalled();
    });
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
  describe('name match weighted by word rarity (ISS-2739)', () => {
    const nameEdgeClauses = (node: any, found: any[] = []): any[] => {
      if (Array.isArray(node)) {
        node.forEach((n) => nameEdgeClauses(n, found));
      } else if (node && typeof node === 'object') {
        if ('name.edge' in node) found.push(node);
        Object.values(node).forEach((v) => nameEdgeClauses(v, found));
      }
      return found;
    };
    const idf = (n: number, df: number) =>
      Math.log(1 + (n - df + 0.5) / (df + 0.5));
    const q = (query: string) => ({ ...baseQuery, query });

    it('replaces the flat edge match with one idf-weighted clause per content word', async () => {
      rarityImpl = () =>
        Promise.resolve({
          hits: { total: { value: 29181 } },
          aggregations: {
            df: {
              buckets: {
                w0: { doc_count: 0 },
                w1: { doc_count: 2 },
                c0: { doc_count: 0 },
                c1: { doc_count: 0 },
              },
            },
          },
        });

      await service.searchHybrid({
        headers,
        query: q('my boyfriend hits me'),
        rankingVersion: 'v2',
      });

      const clauses = nameEdgeClauses(capturedMainRequest.query);
      // Only word-level filters remain; no flat `{ query, boost }` match.
      expect(clauses.map((c) => c['name.edge']).sort()).toEqual([
        'boyfriend',
        'hits',
      ]);

      const walk = (node: any, out: any[] = []): any[] => {
        if (Array.isArray(node)) node.forEach((n) => walk(n, out));
        else if (node && typeof node === 'object') {
          if (node.constant_score?.filter?.match?.['name.edge'] !== undefined) {
            out.push(node.constant_score);
          }
          Object.values(node).forEach((v) => walk(v, out));
        }
        return out;
      };
      const cs = walk(capturedMainRequest.query);
      expect(cs).toHaveLength(2);
      const byWord = Object.fromEntries(
        cs.map((c) => [c.filter.match['name.edge'], c.boost]),
      );
      expect(Object.keys(byWord).sort()).toEqual(['boyfriend', 'hits']);
      expect(byWord.boyfriend).toBeCloseTo(15 * idf(29181, 0));
      expect(byWord.hits).toBeCloseTo(15 * idf(29181, 2));
    });

    it('keeps the flat edge match when the rarity lookup fails', async () => {
      rarityImpl = () => Promise.reject(new Error('es down'));

      await service.searchHybrid({
        headers,
        query: q('my boyfriend hits me'),
        rankingVersion: 'v2',
      });

      const clauses = nameEdgeClauses(capturedMainRequest.query);
      expect(clauses).toEqual([
        { 'name.edge': { query: 'my boyfriend hits me', boost: 15 } },
      ]);
    });

    it('adds no edge clause and sends no rarity request for function-word-only queries', async () => {
      await service.searchHybrid({
        headers,
        query: q('me'),
        rankingVersion: 'v2',
      });

      expect(rarityRequests).toHaveLength(0);
      expect(nameEdgeClauses(capturedMainRequest.query)).toEqual([]);
    });

    it('sends a size-0 tenant-scoped request with a phrase_prefix filter per word', async () => {
      await service.searchHybrid({
        headers,
        query: q('boyfriend hits'),
        rankingVersion: 'v2',
      });

      expect(rarityRequests).toHaveLength(1);
      const req = rarityRequests[0];
      expect(req.size).toBe(0);
      expect(req.query).toEqual({ term: { tenant_id: 'tenant-a' } });
      const filters = req.aggs.df.filters.filters;
      expect(Object.keys(filters).filter((k) => k.startsWith('w'))).toEqual([
        'w0',
        'w1',
      ]);
      expect(filters.w0.multi_match).toMatchObject({
        query: 'boyfriend',
        type: 'phrase_prefix',
      });
      expect(filters.w1.multi_match.query).toBe('hits');
    });

    describe('per-word cache', () => {
      const probedWords = (req: any): string[] =>
        Object.entries(req.aggs.df.filters.filters)
          .filter(([k]) => /^w\d+$/.test(k))
          .map(([, v]: any) => v.multi_match.query);

      it('probes only the words the cache does not hold', async () => {
        await service.searchHybrid({
          headers,
          query: q('boyfriend hits'),
          rankingVersion: 'v2',
        });
        await service.searchHybrid({
          headers,
          query: q('boyfriend shelter'),
          rankingVersion: 'v2',
        });

        expect(rarityRequests).toHaveLength(2);
        expect(probedWords(rarityRequests[0])).toEqual(['boyfriend', 'hits']);
        expect(probedWords(rarityRequests[1])).toEqual(['shelter']);
      });

      it('makes no Elasticsearch rarity call on a full hit, with the same clauses', async () => {
        await service.searchHybrid({
          headers,
          query: q('boyfriend hits'),
          rankingVersion: 'v2',
        });
        const first = JSON.stringify(capturedMainRequest.query);
        await service.searchHybrid({
          headers,
          query: q('hits boyfriend'),
          rankingVersion: 'v2',
        });

        expect(rarityRequests).toHaveLength(1);
        // Word order differs, so compare the set of word clauses.
        expect(nameEdgeClauses(capturedMainRequest.query).length).toBe(
          nameEdgeClauses(JSON.parse(first)).length,
        );
      });

      it('gives a cached word the same idf as a probed word', async () => {
        rarityImpl = () =>
          Promise.resolve({
            hits: { total: { value: 29181 } },
            aggregations: {
              df: {
                buckets: { w0: { doc_count: 2 }, c0: { doc_count: 0 } },
              },
            },
          });
        await service.searchHybrid({
          headers,
          query: q('hits'),
          rankingVersion: 'v2',
        });
        const boostFor = () => {
          const found: any[] = [];
          const walk = (n: any) => {
            if (Array.isArray(n)) n.forEach(walk);
            else if (n && typeof n === 'object') {
              if (n.constant_score?.filter?.match?.['name.edge'] === 'hits') {
                found.push(n.constant_score.boost);
              }
              Object.values(n).forEach(walk);
            }
          };
          walk(capturedMainRequest.query);
          return found[0];
        };
        const probedBoost = boostFor();
        await service.searchHybrid({
          headers,
          query: q('hits'),
          rankingVersion: 'v2',
        });
        expect(rarityRequests).toHaveLength(1);
        expect(boostFor()).toBeCloseTo(probedBoost);
        expect(probedBoost).toBeCloseTo(15 * idf(29181, 2));
      });

      it('keeps tenants and languages apart', async () => {
        await service.searchHybrid({
          headers,
          query: q('hits'),
          rankingVersion: 'v2',
        });
        await service.searchHybrid({
          headers: { ...headers, 'x-tenant-id': 'tenant-b' },
          query: q('hits'),
          rankingVersion: 'v2',
        });
        expect(rarityRequests).toHaveLength(2);
      });

      it('caches a split with its word and replays it from the cache', async () => {
        rarityImpl = (req: any) => {
          const keys = Object.keys(req.aggs.df.filters.filters);
          return Promise.resolve({
            hits: { total: { value: 1000 } },
            aggregations: {
              df: {
                buckets: Object.fromEntries(
                  keys.map((k) => [
                    k,
                    { doc_count: k === 'w0' ? 3 : k === 's0_1' ? 300 : 1 },
                  ]),
                ),
              },
            },
          });
        };
        await service.searchHybrid({
          headers,
          query: q('foodbank'),
          rankingVersion: 'v2',
        });
        const first = JSON.stringify(capturedMainRequest.query);
        await service.searchHybrid({
          headers,
          query: q('foodbank'),
          rankingVersion: 'v2',
        });
        expect(rarityRequests).toHaveLength(1);
        expect(JSON.stringify(capturedMainRequest.query)).toBe(first);
        expect(first).toContain('food bank');
      });

      it('does not cache anything when the probe fails', async () => {
        rarityImpl = () => Promise.reject(new Error('es down'));
        await service.searchHybrid({
          headers,
          query: q('hits'),
          rankingVersion: 'v2',
        });
        expect(cacheStore.size).toBe(0);
      });

      it('keeps the cached entries under the cap, deleting the oldest first', async () => {
        (service as any).wordRarityKeys = new BoundedKeyRegistry(2);
        await service.searchHybrid({
          headers,
          query: q('boyfriend hits shelter'),
          rankingVersion: 'v2',
        });
        expect(cacheStore.size).toBe(2);
        const keys = [...cacheStore.keys()];
        expect(keys.some((k) => k.includes('boyfriend'))).toBe(false);
      });

      it('still answers correctly when the cache read fails', async () => {
        cacheGetMany = (keys) => Promise.resolve(keys.map(() => undefined));
        cacheSetMany = () => Promise.resolve();
        await service.searchHybrid({
          headers,
          query: q('boyfriend hits'),
          rankingVersion: 'v2',
        });
        expect(rarityRequests).toHaveLength(1);
        expect(nameEdgeClauses(capturedMainRequest.query)).toHaveLength(2);
      });

      it('falls back to the flat match when the cache layer itself throws', async () => {
        cacheGetMany = () => Promise.reject(new Error('redis down'));
        await service.searchHybrid({
          headers,
          query: q('boyfriend hits'),
          rankingVersion: 'v2',
        });
        expect(nameEdgeClauses(capturedMainRequest.query)).toEqual([
          { 'name.edge': { query: 'boyfriend hits', boost: 15 } },
        ]);
      });
    });
  });

  describe('query length and logging (ISS-2739 follow-up)', () => {
    const long = (n: number) => `shelter ${'z'.repeat(n)}`;

    it('v2 rejects a query over 500 characters with a 400', async () => {
      await expect(
        service.searchHybrid({
          headers,
          query: { ...baseQuery, query: long(600) },
          rankingVersion: 'v2',
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(esSearch).not.toHaveBeenCalled();
    });

    it('v2 accepts a query of exactly 500 characters', async () => {
      await expect(
        service.searchHybrid({
          headers,
          query: { ...baseQuery, query: 'a'.repeat(500) },
          rankingVersion: 'v2',
        }),
      ).resolves.toBeDefined();
    });

    it('v1 rejects a query over 500 characters with a 400', async () => {
      await expect(
        service.searchHybrid({
          headers,
          query: { ...baseQuery, query: long(600) },
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(esSearch).not.toHaveBeenCalled();
    });

    it('v1 accepts a query of exactly 500 characters', async () => {
      await expect(
        service.searchHybrid({
          headers,
          query: { ...baseQuery, query: 'a'.repeat(500) },
        }),
      ).resolves.toBeDefined();
    });

    it.each([
      ['v1', undefined],
      ['v2', 'v2' as const],
    ])(
      '%s info log carries length and id only, never any query text',
      async (_n, rankingVersion) => {
        const logSpy = jest.spyOn((service as any).logger, 'log');
        const text = `help ${'q'.repeat(300)}`;
        await service.searchHybrid({
          headers,
          query: { ...baseQuery, query: text },
          rankingVersion,
        });
        const lines = logSpy.mock.calls.map((c) => String(c[0]));
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
          expect(line).not.toContain(text);
          expect(line).not.toContain('help');
          expect(line).not.toContain('qqqq');
        }
        expect(lines.join('\n')).toMatch(/len=305 id=[0-9a-f]{12}(?! start)/);
      },
    );
  });

  it.each([
    ['v1', undefined],
    ['v2', 'v2' as const],
  ])(
    '%s debug log never carries the full query text',
    async (_n, rankingVersion) => {
      const debugSpy = jest.spyOn((service as any).logger, 'debug');
      const text = `help ${'q'.repeat(300)}`;
      await service.searchHybrid({
        headers,
        query: { ...baseQuery, query: text },
        rankingVersion,
      });
      const lines = debugSpy.mock.calls.map((c) => String(c[0]));
      for (const line of lines) {
        expect(line).not.toContain(text);
        expect(line).not.toContain('q'.repeat(41));
      }
      expect(lines.join('\n')).toMatch(/len=305 id=[0-9a-f]{12}/);
    },
  );

  describe('v1 is unchanged without rankingVersion (/search regression guard)', () => {
    const collect = (node: any, pred: (n: any) => boolean, out: any[] = []) => {
      if (Array.isArray(node)) node.forEach((n) => collect(n, pred, out));
      else if (node && typeof node === 'object') {
        if (pred(node)) out.push(node);
        Object.values(node).forEach((v) => collect(v, pred, out));
      }
      return out;
    };

    it('sends no rarity request, keeps approximate knn and the flat name edge match', async () => {
      await service.searchHybrid({
        headers,
        query: { ...baseQuery, query: 'my boyfriend hits me' },
      });

      expect(rarityRequests).toHaveLength(0);
      expect(
        esSearch.mock.calls.some(([r]) => r.size === 0 && r.aggs && r.aggs.df),
      ).toBe(false);

      const taxonomyCall = esSearch.mock.calls
        .map((c) => c[0])
        .find((req) => req.index === 'hybrid_taxonomies');
      expect(taxonomyCall.knn).toMatchObject({
        field: 'embedding',
        query_vector: [0.1, 0.2, 0.3, 0.4],
        k: 10,
        num_candidates: 500,
        filter: [{ term: { tenant_id: 'tenant-a' } }],
      });
      expect(taxonomyCall.query?.script_score).toBeUndefined();

      const main = capturedMainRequest.query;
      expect(
        collect(main, (n) => 'name.edge' in n && n['name.edge'].query),
      ).toEqual([
        { 'name.edge': { query: 'my boyfriend hits me', boost: 15 } },
      ]);
      expect(
        collect(main, (n) => n.constant_score?.filter?.match?.['name.edge']),
      ).toEqual([]);
      expect(collect(main, (n) => 'name.clean' in n && 'prefix' in n)).toEqual(
        [],
      );
      expect(
        collect(main, (n) => n.prefix && 'name.clean' in n.prefix),
      ).toEqual([]);
    });
  });

  describe('run-together words: joins and splits (v2 only)', () => {
    const N = 29181;
    const idf = (n: number, df: number) =>
      Math.log(1 + (n - df + 0.5) / (df + 0.5));
    const walk = (
      node: any,
      pred: (n: any) => boolean,
      out: any[] = [],
    ): any[] => {
      if (Array.isArray(node)) node.forEach((n) => walk(n, pred, out));
      else if (node && typeof node === 'object') {
        if (pred(node)) out.push(node);
        Object.values(node).forEach((v) => walk(v, pred, out));
      }
      return out;
    };
    const joinedClauses = (node: any) =>
      walk(node, (n) => n.constant_score?.filter?.prefix?.['name.clean']).map(
        (n) => n.constant_score,
      );
    const splitNameClauses = (node: any) =>
      walk(
        node,
        (n) => n.constant_score?.filter?.match_phrase?.['name.clean'],
      ).map((n) => n.constant_score);
    const splitRecallClauses = (node: any) =>
      walk(
        node,
        (n) => n.multi_match?.type === 'phrase' && !n.multi_match.boost,
      );
    const respond = (counts: Record<string, number>) => () =>
      Promise.resolve({
        hits: { total: { value: N } },
        aggregations: {
          df: {
            buckets: Object.fromEntries(
              [
                ...Object.entries(counts),
                // Document-count buckets for the typo gate: low, so the
                // clause list keeps its typo clauses as before.
                ...Object.keys(counts)
                  .filter((k) => k.startsWith('w'))
                  .map((k): [string, number] => [`c${k.slice(1)}`, 0]),
              ].map(([k, v]) => [k, { doc_count: v }]),
            ),
          },
        },
      });
    const run = (query: string) =>
      service.searchHybrid({
        headers,
        query: { ...baseQuery, query },
        rankingVersion: 'v2',
      });

    it('JOIN: "food bank near me" adds a prefix clause for "foodbank" worth both word rarities', async () => {
      rarityImpl = respond({
        w0: 800,
        w1: 600,
        w2: 2000,
      });

      await run('food bank near me');

      const cs = joinedClauses(capturedMainRequest.query);
      const byJoin = Object.fromEntries(
        cs.map((c) => [c.filter.prefix['name.clean'], c.boost]),
      );
      expect(byJoin.foodbank).toBeCloseTo(15 * (idf(N, 800) + idf(N, 600)));
      // "me" is a function word and adds 0, so "nearme" is worth "near" only.
      expect(byJoin.nearme).toBeCloseTo(15 * idf(N, 2000));
      expect(byJoin.foodbanknear).toBeDefined();
    });

    it('JOIN: "my free taxes" adds "myfreetaxes" worth the sum of the word rarities', async () => {
      rarityImpl = respond({ w0: 10, w1: 400 });

      await run('my free taxes');

      const cs = joinedClauses(capturedMainRequest.query);
      const c = cs.find((x) => x.filter.prefix['name.clean'] === 'myfreetaxes');
      expect(c).toBeDefined();
      expect(c.boost).toBeCloseTo(15 * (idf(N, 10) + idf(N, 400)));
    });

    it('JOIN: adds no joined clause for a single-word query', async () => {
      await run('myfreetaxes');

      expect(joinedClauses(capturedMainRequest.query)).toEqual([]);
    });

    it('JOIN: adds no name.edge and no joined clause when every word is a function word', async () => {
      await run('me and you');

      expect(joinedClauses(capturedMainRequest.query)).toEqual([]);
      expect(JSON.stringify(capturedMainRequest.query)).not.toContain(
        'name.edge',
      );
    });

    it('SPLIT: "foodbank" adds a name clause and a recall clause for "food bank"', async () => {
      rarityImpl = respond({ w0: 3, s0_0: 1, s0_1: 1622, s0_2: 2 });

      await run('foodbank');

      const cs = splitNameClauses(capturedMainRequest.query);
      expect(cs).toHaveLength(1);
      expect(cs[0].filter).toEqual({
        match_phrase: { 'name.clean': 'food bank' },
      });
      expect(cs[0].boost).toBeCloseTo(15 * idf(N, 1622));

      const recall = splitRecallClauses(capturedMainRequest.query);
      expect(recall).toHaveLength(1);
      expect(recall[0].multi_match.query).toBe('food bank');
    });

    it('SPLIT: adds nothing when no split phrase is more common than the word', async () => {
      rarityImpl = respond({ w0: 3, s0_0: 1, s0_1: 3, s0_2: 2 });

      await run('foodbank');

      expect(splitNameClauses(capturedMainRequest.query)).toEqual([]);
      expect(splitRecallClauses(capturedMainRequest.query)).toEqual([]);
    });

    it('SPLIT: the rarity request carries phrase buckets for the split candidates', async () => {
      await run('foodbank');

      const filters = rarityRequests[0].aggs.df.filters.filters;
      expect(filters.s0_1.multi_match).toMatchObject({
        query: 'food bank',
        type: 'phrase',
      });
      expect(Object.keys(filters).filter((k) => k.startsWith('s0_'))).toEqual([
        's0_0',
        's0_1',
        's0_2',
      ]);
    });
  });
});
