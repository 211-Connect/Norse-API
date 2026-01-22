import { Test, TestingModule } from '@nestjs/testing';
import { SearchService } from './search.service';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { SearchQueryDto } from './dto/search-query.dto';

describe('SearchService Geo', () => {
  let service: SearchService;
  let esService: ElasticsearchService;

  const mockEsService = {
    search: jest.fn().mockResolvedValue({
      hits: { total: { value: 0 }, hits: [] },
      aggregations: {},
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: ElasticsearchService, useValue: mockEsService },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
    esService = module.get<ElasticsearchService>(ElasticsearchService);
    jest.clearAllMocks();
  });

  const baseOptions = {
    headers: { 'accept-language': 'en', 'x-tenant-id': 'tenant-1' } as any,
    tenant: { facets: [] } as any,
  };

  it('should build bbox filter correctly', async () => {
    const query: SearchQueryDto = {
      geo_type: 'bbox',
      bbox: [-97, 43, -89, 49], // min_lon, min_lat, max_lon, max_lat
      query: 'food',
      query_type: 'text',
      page: 1,
      filters: {},
      distance: 0,
      limit: 25,
    };

    await service.searchResources({ ...baseOptions, query });

    const call = mockEsService.search.mock.calls[0][0];
    const boolQuery = call.query.bool;
    const geoFilter = boolQuery.filter.find((f) => f.geo_shape);

    expect(geoFilter).toBeDefined();
    expect(geoFilter.geo_shape.service_area.shape.type).toBe('envelope');
    // Top Left: [min_lon, max_lat] -> [-97, 49]
    // Bottom Right: [max_lon, min_lat] -> [-89, 43]
    expect(geoFilter.geo_shape.service_area.shape.coordinates).toEqual([
      [-97, 49],
      [-89, 43],
    ]);
  });

  it('should build radius filter correctly', async () => {
    // geo_type=radius, coords=[lat, lon] -> [47, -122]
    const query: SearchQueryDto = {
      geo_type: 'radius',
      coords: [47, -122],
      distance: 5,
      query: 'food',
      query_type: 'text',
      page: 1,
      filters: {},
      limit: 25,
    };

    await service.searchResources({ ...baseOptions, query });

    const call = mockEsService.search.mock.calls[0][0];
    const boolQuery = call.query.bool;
    const geoFilter = boolQuery.filter.find((f) => f.geo_distance);

    expect(geoFilter).toBeDefined();
    expect(geoFilter.geo_distance.distance).toBe('5miles');
    // New logic: coords are [lat, lon]
    expect(geoFilter.geo_distance.location).toEqual({ lat: 47, lon: -122 });

    // Verify sort
    const sort = call.sort;
    // sort[0] is priority, sort[1] is _geo_distance
    expect(sort[1]._geo_distance['location.point']).toEqual({
      lat: 47,
      lon: -122,
    });
  });

  it('should build legacy filter correctly', async () => {
    // coords=[lon, lat] -> [-122, 47] - Legacy format
    const query: SearchQueryDto = {
      coords: [-122, 47],
      distance: 5,
      query: 'food',
      query_type: 'text',
      page: 1,
      filters: {},
      limit: 25,
      // No geo_type
    };

    await service.searchResources({ ...baseOptions, query });

    const call = mockEsService.search.mock.calls[0][0];
    const boolQuery = call.query.bool;

    // Legacy: Should have geo_shape point intersection
    const shapeFilter = boolQuery.filter.find((f) => f.geo_shape);
    expect(shapeFilter).toBeDefined();
    expect(shapeFilter.geo_shape.service_area.shape.type).toBe('point');
    expect(shapeFilter.geo_shape.service_area.shape.coordinates).toEqual([
      -122, 47,
    ]);

    // Legacy: sort uses lon, lat
    const sort = call.sort;
    expect(sort[1]._geo_distance['location.point']).toEqual({
      lon: -122,
      lat: 47,
    });
  });
});
