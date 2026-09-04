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

  describe('query_type=organization', () => {
    it('filters by organization.name.lc term OR resource name match_phrase', async () => {
      const query: SearchResourcesQueryDto = {
        query: 'Example Org',
        query_type: 'organization',
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

      const request = elasticsearchService.search.mock.calls[0][0];
      const orgFilter = request.query.bool.filter.find(
        (clause: any) =>
          clause.bool?.should &&
          clause.bool.should.some((s: any) => s.term?.['organization.name.lc']),
      );
      expect(orgFilter).toBeDefined();
      expect(orgFilter.bool.should).toContainEqual({
        term: { 'organization.name.lc': 'example org' },
      });
      expect(orgFilter.bool.should).toContainEqual({
        match_phrase: { name: 'example org' },
      });
      expect(orgFilter.bool.minimum_should_match).toBe(1);
    });

    it('composes the organization filter with other existing filters (e.g. coords/distance)', async () => {
      const query: SearchResourcesQueryDto = {
        query: 'Example Org',
        query_type: 'organization',
        page: 1,
        limit: 25,
        filters: {},
        taxonomy: [],
        coords: [-120.740135, 47.751076],
        distance: 10,
        sort: 'relevance',
      };

      await service.searchResources({
        headers: { 'x-tenant-id': 'tenant-1', 'accept-language': 'en' } as any,
        query,
      });

      const request = elasticsearchService.search.mock.calls[0][0];
      const filterClauses = request.query.bool.filter;
      // The compound org filter (bool.should with term+match_phrase) is one clause
      expect(
        filterClauses.some(
          (clause: any) =>
            clause.bool?.should &&
            clause.bool.should.some(
              (s: any) => s.term?.['organization.name.lc'],
            ),
        ),
      ).toBe(true);
      // service_area geo_shape clause from the shared filter builder should
      // still be present alongside the org filter.
      expect(filterClauses.some((clause: any) => 'geo_shape' in clause)).toBe(
        true,
      );
    });

    it('rejects an empty/whitespace query', async () => {
      const query: SearchResourcesQueryDto = {
        query: '   ',
        query_type: 'organization',
        page: 1,
        limit: 25,
        filters: {},
        taxonomy: [],
        distance: 0,
        sort: 'relevance',
      };

      await expect(
        service.searchResources({
          headers: {
            'x-tenant-id': 'tenant-1',
            'accept-language': 'en',
          } as any,
          query,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an array query', async () => {
      const query: SearchResourcesQueryDto = {
        query: ['Example Org', 'Other Org'],
        query_type: 'organization',
        page: 1,
        limit: 25,
        filters: {},
        taxonomy: [],
        distance: 0,
        sort: 'relevance',
      };

      await expect(
        service.searchResources({
          headers: {
            'x-tenant-id': 'tenant-1',
            'accept-language': 'en',
          } as any,
          query,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a complex AND/OR query object', async () => {
      const query: SearchResourcesQueryDto = {
        query: { OR: ['Example Org'] },
        query_type: 'organization',
        page: 1,
        limit: 25,
        filters: {},
        taxonomy: [],
        distance: 0,
        sort: 'relevance',
      };

      await expect(
        service.searchResources({
          headers: {
            'x-tenant-id': 'tenant-1',
            'accept-language': 'en',
          } as any,
          query,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
