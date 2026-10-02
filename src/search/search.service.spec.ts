import { Test, TestingModule } from '@nestjs/testing';
import { createMetricsServiceMock } from 'src/metrics/testing/metrics-service.mock';
import { SearchService } from './search.service';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { TenantConfigService } from '../cms-config/tenant-config.service';
import { OrchestrationConfigService } from '../cms-config/orchestration-config.service';
import { HybridSearchService } from './hybrid-search.service';
import { BadRequestException } from '@nestjs/common';
import { SearchResourcesQueryDto } from './dto/search-query.dto';
import { MetricsService } from 'src/metrics/metrics.service';

describe('SearchService', () => {
  let service: SearchService;
  let elasticsearchService: { search: jest.Mock };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        {
          provide: ElasticsearchService,
          useValue: {
            search: jest.fn(),
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
          provide: OrchestrationConfigService,
          useValue: {
            getCustomAttributesByTenantId: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: HybridSearchService,
          useValue: {
            searchHybrid: jest.fn(),
          },
        },
        {
          provide: MetricsService,
          useValue: createMetricsServiceMock(),
        },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
    elasticsearchService = module.get(ElasticsearchService);

    elasticsearchService.search.mockResolvedValue({
      aggregations: {},
      hits: { hits: [], total: { value: 0, relation: 'eq' } },
      _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
      timed_out: false,
      took: 1,
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('uses provided limit when calculating pagination offset', async () => {
    const query: SearchResourcesQueryDto = {
      query: 'housing',
      query_type: 'text',
      page: 3,
      limit: 100,
      filters: {},
      taxonomy: [],
      distance: 0,
      sort: 'relevance',
    };

    await service.searchResources({
      headers: { 'x-tenant-id': 'tenant-1', 'accept-language': 'en' } as any,
      query,
    });

    const request = elasticsearchService.search.mock.calls[0][0];
    expect(request.from).toBe(200);
    expect(request.size).toBe(100);
  });

  it('accepts complex taxonomy query objects', async () => {
    const query: SearchResourcesQueryDto = {
      query: {
        OR: ['food', { AND: ['shelter', 'transportation'] }],
      },
      query_type: 'taxonomy',
      page: 1,
      limit: 25,
      filters: {},
      taxonomy: [],
      distance: 0,
      sort: 'relevance',
    };

    await expect(
      service.searchResources({
        headers: { 'x-tenant-id': 'tenant-1', 'accept-language': 'en' } as any,
        query,
      }),
    ).resolves.toBeDefined();
  });

  it('rejects complex query objects for non-taxonomy query_type', async () => {
    const query: SearchResourcesQueryDto = {
      query: { OR: ['housing'] },
      query_type: 'text',
      page: 1,
      limit: 25,
      filters: {},
      taxonomy: [],
      distance: 0,
      sort: 'relevance',
    };

    await expect(
      service.searchResources({
        headers: { 'x-tenant-id': 'tenant-1', 'accept-language': 'en' } as any,
        query,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  describe('organization_id filter', () => {
    const hasOrgTerm = (filterClauses: any[]) =>
      filterClauses.some(
        (clause: any) => clause.term?.['organization.id'] === 'org-123',
      );

    it('terminal org view: empty query + organization_id -> match_all scoped by organization.id', async () => {
      const query: SearchResourcesQueryDto = {
        query: '',
        query_type: 'text',
        page: 1,
        limit: 25,
        filters: {},
        organization_id: 'org-123',
        taxonomy: [],
        distance: 0,
        sort: 'relevance',
      };

      await service.searchResources({
        headers: { 'x-tenant-id': 'tenant-1', 'accept-language': 'en' } as any,
        query,
      });

      const request = elasticsearchService.search.mock.calls[0][0];
      expect(request.query.bool.must).toEqual({ match_all: {} });
      expect(hasOrgTerm(request.query.bool.filter)).toBe(true);
    });

    it('composes with a text query: keyword search scoped by organization.id', async () => {
      const query: SearchResourcesQueryDto = {
        query: 'housing',
        query_type: 'text',
        page: 1,
        limit: 25,
        filters: {},
        organization_id: 'org-123',
        taxonomy: [],
        distance: 0,
        sort: 'relevance',
      };

      await service.searchResources({
        headers: { 'x-tenant-id': 'tenant-1', 'accept-language': 'en' } as any,
        query,
      });

      const request = elasticsearchService.search.mock.calls[0][0];
      // keyword query still matches text via should clauses...
      expect(request.query.bool.should).toBeDefined();
      // ...and is scoped to the org by the shared filter builder.
      expect(hasOrgTerm(request.query.bool.filter)).toBe(true);
    });

    it('composes with geo (coords/distance) alongside the org scope', async () => {
      const query: SearchResourcesQueryDto = {
        query: '',
        query_type: 'text',
        page: 1,
        limit: 25,
        filters: {},
        organization_id: 'org-123',
        taxonomy: [],
        coords: [-120.740135, 47.751076],
        distance: 10,
        sort: 'relevance',
      };

      await service.searchResources({
        headers: { 'x-tenant-id': 'tenant-1', 'accept-language': 'en' } as any,
        query,
      });

      const filterClauses =
        elasticsearchService.search.mock.calls[0][0].query.bool.filter;
      expect(hasOrgTerm(filterClauses)).toBe(true);
      expect(filterClauses.some((clause: any) => 'geo_shape' in clause)).toBe(
        true,
      );
    });

    it('omits the organization.id term when organization_id is absent', async () => {
      const query: SearchResourcesQueryDto = {
        query: 'housing',
        query_type: 'text',
        page: 1,
        limit: 25,
        filters: {},
        taxonomy: [],
        distance: 0,
        sort: 'relevance',
      };

      await service.searchResources({
        headers: { 'x-tenant-id': 'tenant-1', 'accept-language': 'en' } as any,
        query,
      });

      const filterClauses =
        elasticsearchService.search.mock.calls[0][0].query.bool.filter;
      expect(
        filterClauses.some((clause: any) => clause.term?.['organization.id']),
      ).toBe(false);
    });
  });

  describe('pinned_resources_mode', () => {
    let tenantConfigService: { getSearchConfig: jest.Mock };

    beforeEach(() => {
      tenantConfigService = (service as any).tenantConfigService;
    });

    it('omits the priority sort tier when pinned_resources_mode is ignore', async () => {
      tenantConfigService.getSearchConfig.mockResolvedValue({
        pinned_resources_mode: 'ignore',
      });

      await service.searchResources({
        headers: { 'x-tenant-id': 'tenant-1', 'accept-language': 'en' } as any,
        query: {
          query: 'housing',
          query_type: 'text',
          page: 1,
          limit: 25,
          filters: {},
          taxonomy: [],
          distance: 0,
          sort: 'relevance',
        },
      });

      const request = elasticsearchService.search.mock.calls[0][0];
      expect(request.sort).not.toContainEqual({ priority: 'desc' });
      expect(request.sort).toEqual([
        '_score',
        { 'service_at_location_id.raw': { order: 'asc' } },
      ]);
    });

    it('keeps the priority sort tier when pinned_resources_mode is boost', async () => {
      tenantConfigService.getSearchConfig.mockResolvedValue({
        pinned_resources_mode: 'boost',
      });

      await service.searchResources({
        headers: { 'x-tenant-id': 'tenant-1', 'accept-language': 'en' } as any,
        query: {
          query: 'housing',
          query_type: 'text',
          page: 1,
          limit: 25,
          filters: {},
          taxonomy: [],
          distance: 0,
          sort: 'relevance',
        },
      });

      const request = elasticsearchService.search.mock.calls[0][0];
      expect(request.sort[0]).toEqual({ priority: 'desc' });
    });

    it('defaults to keeping the priority sort tier when pinned_resources_mode is missing', async () => {
      tenantConfigService.getSearchConfig.mockResolvedValue({});

      await service.searchResources({
        headers: { 'x-tenant-id': 'tenant-1', 'accept-language': 'en' } as any,
        query: {
          query: 'housing',
          query_type: 'text',
          page: 1,
          limit: 25,
          filters: {},
          taxonomy: [],
          distance: 0,
          sort: 'relevance',
        },
      });

      const request = elasticsearchService.search.mock.calls[0][0];
      expect(request.sort[0]).toEqual({ priority: 'desc' });
    });
  });

  // Typo tolerance has to reach the query, not just exist as a helper. With
  // `operator: AND` and no stemming on resources_*, one transposed letter
  // returned zero results out of 63,580 — see internal/text-matching.
  it('pairs every lexical clause with a de-boosted fuzzy fallback', async () => {
    await service.searchResources({
      headers: { 'x-tenant-id': 'tenant-1', 'accept-language': 'en' } as any,
      query: {
        // 'text' with a non-empty query resolves to the internal KEYWORD
        // branch (getQueryType), which is the clause 51 of 59 tenants hit.
        query: 'hosuing assistance',
        query_type: 'text',
        page: 1,
        limit: 25,
        filters: {},
        taxonomy: [],
        distance: 0,
        sort: 'relevance',
      } as SearchResourcesQueryDto,
    });

    const request = elasticsearchService.search.mock.calls[0][0];
    const clauses: string[] =
      JSON.stringify(request).match(/"multi_match":\{.*?\}/g) ?? [];
    const fuzzy = clauses.filter((c) => c.includes('"fuzziness":"AUTO"'));
    const exact = clauses.filter((c) => !c.includes('"fuzziness":"AUTO"'));

    // One fallback per exact clause — never a replacement, or queries with no
    // typo get reordered for no reason.
    expect(exact.length).toBeGreaterThan(0);
    expect(fuzzy.length).toBe(exact.length);
    for (const c of fuzzy) {
      expect(c).toContain('"prefix_length":2');
      expect(c).toContain('"boost":0.01');
    }
  });
});
