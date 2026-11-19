import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { createMetricsServiceMock } from 'src/metrics/testing/metrics-service.mock';
import { MetricsService } from 'src/metrics/metrics.service';
import { RegionService } from 'src/region/internal';
import { TenantConfigService } from '../cms-config/tenant-config.service';
import { OrchestrationConfigService } from '../cms-config/orchestration-config.service';
import { SearchService } from './search.service';
import { HybridSearchService } from './hybrid-search.service';
import { SearchResourcesQueryDto } from './dto/search-query.dto';
import { SearchUtilsService } from './search-utils.service';

const KING = {
  id: 'county:53033',
  type: 'county',
  name: 'King County, WA',
  state: 'WA',
};

const query = (
  overrides: Partial<SearchResourcesQueryDto> = {},
): SearchResourcesQueryDto => ({
  query: '',
  query_type: 'text',
  page: 1,
  limit: 25,
  filters: {},
  taxonomy: [],
  distance: 0,
  sort: 'relevance',
  ...overrides,
});
const headers = { 'x-tenant-id': 'tenant-1', 'accept-language': 'en' } as any;

describe('SearchService area search (region)', () => {
  let service: SearchService;
  const search = jest.fn();
  const getSearchConfig = jest.fn();
  const getSummaries = jest.fn();
  const searchHybrid = jest.fn();
  const buildPinsRequest = jest.fn();
  const sentFilters = () => search.mock.calls[0][0].query.bool.filter;

  beforeEach(async () => {
    jest.clearAllMocks();
    search.mockResolvedValue({
      aggregations: {},
      hits: { hits: [], total: { value: 0, relation: 'eq' } },
      _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
      timed_out: false,
      took: 1,
    });
    getSearchConfig.mockResolvedValue({});
    getSummaries.mockResolvedValue([KING]);
    searchHybrid.mockResolvedValue({ search: {}, facets: [] });
    buildPinsRequest.mockResolvedValue({ query: { match_all: {} } });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: ElasticsearchService, useValue: { search } },
        {
          provide: TenantConfigService,
          useValue: { getFacets: jest.fn(async () => []), getSearchConfig },
        },
        {
          provide: OrchestrationConfigService,
          useValue: { getCustomAttributesByTenantId: jest.fn(async () => []) },
        },
        {
          provide: HybridSearchService,
          useValue: { searchHybrid, buildPinsRequest },
        },
        { provide: MetricsService, useValue: createMetricsServiceMock() },
        { provide: RegionService, useValue: { getSummaries } },
      ],
    }).compile();
    service = module.get(SearchService);
  });

  it('filters by the Region with the default match and reports it', async () => {
    const response = await service.searchResources({
      headers,
      query: query({ region: ['county:53033'], coords: [-122, 47.5] }),
    });

    expect(sentFilters()).toContainEqual(
      SearchUtilsService.buildRegionFilter({
        regionIds: ['county:53033'],
        match: 'located_or_serving',
        unlocated: 'virtual',
      }),
    );
    expect(response.resolved_location).toEqual({
      regions: [KING],
      area_match: 'located_or_serving',
      unlocated: 'virtual',
    });
  });

  it('takes the tenant CMS defaults when the caller sends none', async () => {
    getSearchConfig.mockResolvedValue({
      area_match: 'serving',
      unlocated_in_area_search: 'none',
    });

    const response = await service.searchResources({
      headers,
      query: query({ region: ['county:53033'] }),
    });

    expect(response.resolved_location).toMatchObject({
      area_match: 'serving',
      unlocated: 'none',
    });
  });

  it('reads a cache written before unlocated_in_area_search existed', async () => {
    getSearchConfig.mockResolvedValue({
      include_unlocated_in_area_search: true,
    });

    const response = await service.searchResources({
      headers,
      query: query({ region: ['county:53033'] }),
    });

    expect(response.resolved_location?.unlocated).toBe('all');
  });

  it('falls back to virtual for an invalid tenant value', async () => {
    getSearchConfig.mockResolvedValue({ unlocated_in_area_search: 'some' });

    const response = await service.searchResources({
      headers,
      query: query({ region: ['county:53033'] }),
    });

    expect(response.resolved_location?.unlocated).toBe('virtual');
  });

  it('prefers the params the caller sends over the tenant defaults', async () => {
    getSearchConfig.mockResolvedValue({
      area_match: 'serving',
      unlocated_in_area_search: 'all',
    });

    const response = await service.searchResources({
      headers,
      query: query({
        region: ['county:53033'],
        area_match: 'located',
        unlocated: 'none',
      }),
    });

    expect(response.resolved_location).toMatchObject({
      area_match: 'located',
      unlocated: 'none',
    });
  });

  it('falls back to located_or_serving for an invalid tenant value', async () => {
    getSearchConfig.mockResolvedValue({ area_match: 'everywhere' });

    const response = await service.searchResources({
      headers,
      query: query({ region: ['county:53033'] }),
    });

    expect(response.resolved_location?.area_match).toBe('located_or_serving');
  });

  it('rejects unknown Regions before searching', async () => {
    getSummaries.mockRejectedValue(new BadRequestException('Unknown'));

    await expect(
      service.searchResources({
        headers,
        query: query({ region: ['county:00000'] }),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(search).not.toHaveBeenCalled();
  });

  it('hands the area to hybrid search', async () => {
    await service.searchResources({
      headers,
      query: query({ region: ['county:53033'], query_type: 'hybrid' }),
    });

    expect(searchHybrid.mock.calls[0][0].area).toEqual({
      regionIds: ['county:53033'],
      match: 'located_or_serving',
      unlocated: 'virtual',
    });
  });

  it('applies the area to map pins', async () => {
    await service.searchPins({
      headers,
      query: query({ region: ['county:53033'], area_match: 'located' }),
    });

    const sent = JSON.stringify(search.mock.calls[0][0]);
    expect(sent).toContain(
      JSON.stringify(
        SearchUtilsService.buildRegionFilter({
          regionIds: ['county:53033'],
          match: 'located',
          unlocated: 'virtual',
        }),
      ),
    );
  });

  it('leaves a search without region untouched', async () => {
    const response = await service.searchResources({
      headers,
      query: query({ coords: [-122, 47.5], distance: 10 }),
    });

    expect(getSummaries).not.toHaveBeenCalled();
    expect(response.resolved_location).toBeUndefined();
  });

  it('gives an area search its own shard preference', async () => {
    await service.searchResources({ headers, query: query() });
    await service.searchResources({
      headers,
      query: query({ region: ['county:53033'] }),
    });
    await service.searchResources({
      headers,
      query: query({ region: ['county:53033'], area_match: 'serving' }),
    });

    const preferences = search.mock.calls.map(([r]) => r.preference);
    expect(new Set(preferences).size).toBe(3);
  });
});
