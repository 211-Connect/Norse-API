import { Test, TestingModule } from '@nestjs/testing';
import { SearchService } from './search.service';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { TenantConfigService } from '../cms-config/tenant-config.service';
import { OrchestrationConfigService } from '../cms-config/orchestration-config.service';
import { HybridSearchService } from './hybrid-search.service';
import { BadRequestException } from '@nestjs/common';
import { SearchResourcesQueryDto } from './dto/search-query.dto';

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
});
