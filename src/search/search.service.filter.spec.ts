import { Test, TestingModule } from '@nestjs/testing';
import { SearchService } from './search.service';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { SearchQueryDto } from './dto/search-query.dto';
import { BadRequestException } from '@nestjs/common';
import { SearchBodyDto } from './dto/search-body.dto';

describe('SearchService Logic', () => {
  let service: SearchService;

  const mockEsService = {
    search: jest.fn().mockResolvedValue({
      aggregations: {},
      hits: { hits: [], total: { value: 0 } },
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        {
          provide: ElasticsearchService,
          useValue: mockEsService,
        },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);

    jest.clearAllMocks();
  });

  const getFiltersFromLastCall = () => {
    const callArgs = mockEsService.search.mock.calls[0][0];
    return callArgs.query.bool.filter;
  };

  const baseQuery: SearchQueryDto = {
    query: '',
    page: 1,
    limit: 25,
    filters: {},
    distance: 0,
    query_type: 'text',
  };

  it('should apply boundary search filter', async () => {
    const query: SearchQueryDto = { ...baseQuery, geo_type: 'boundary' };
    const geometry: any = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    };
    const body: SearchBodyDto = { geometry };

    await service.searchResources({
      headers: {} as any,
      query,
      body,
      tenant: {} as any,
    });

    const filters = getFiltersFromLastCall();
    const geoShapeFilter = filters.find(
      (f) => f.geo_shape && f.geo_shape.service_area,
    );
    expect(geoShapeFilter).toBeDefined();
    expect(geoShapeFilter.geo_shape.service_area.relation).toBe('intersects');
    expect(geoShapeFilter.geo_shape.service_area.shape).toEqual(geometry);
  });

  it('should throw BadRequestException if boundary search missing geometry', async () => {
    const query: SearchQueryDto = { ...baseQuery, geo_type: 'boundary' };

    await expect(
      service.searchResources({ headers: {} as any, query, tenant: {} as any }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should apply double filtering for proximity search (coords + distance > 0)', async () => {
    const query: SearchQueryDto = {
      ...baseQuery,
      coords: [-93.2, 44.9],
      distance: 10,
    };

    await service.searchResources({
      headers: {} as any,
      query,
      tenant: {} as any,
    });

    const filters = getFiltersFromLastCall();

    // Filter 1: Service Area Contains
    const svcAreaFilter = filters.find(
      (f) => f.geo_shape && f.geo_shape.service_area,
    );
    expect(svcAreaFilter).toBeDefined();
    expect(svcAreaFilter.geo_shape.service_area.relation).toBe('contains');
    expect(svcAreaFilter.geo_shape.service_area.shape.coordinates).toEqual([
      -93.2, 44.9,
    ]);

    // Filter 2: Geo Distance
    // Implementation wraps it in bool -> should -> bool -> must -> geo_distance
    // Or just look for any filter that has bool logic
    // In code: filters.push({ bool: { should: [ ... ] } })
    const boolFilter = filters.find((f) => f.bool && f.bool.should);
    expect(boolFilter).toBeDefined();

    // Dig deeper to find geo_distance
    const shouldClauses = boolFilter.bool.should;
    const mustDate = shouldClauses.find((c) => c.bool && c.bool.must);
    const geoDist = mustDate.bool.must.find((m) => m.geo_distance);

    expect(geoDist).toBeDefined();
    expect(geoDist.geo_distance.distance).toBe('10miles');
    expect(geoDist.geo_distance['location.point']).toEqual({
      lon: -93.2,
      lat: 44.9,
    });
  });

  it('should apply ONLY service area filter for proximity search (distance = 0)', async () => {
    const query: SearchQueryDto = {
      ...baseQuery,
      coords: [-93.2, 44.9],
      distance: 0,
    };

    await service.searchResources({
      headers: {} as any,
      query,
      tenant: {} as any,
    });

    const filters = getFiltersFromLastCall();

    const svcAreaFilter = filters.find(
      (f) => f.geo_shape && f.geo_shape.service_area,
    );
    expect(svcAreaFilter).toBeDefined();

    // Should NOT have geo_distance filter
    const boolFilter = filters.find((f) => f.bool && f.bool.should); // This was the complex double filter structure
    expect(boolFilter).toBeUndefined();
  });

  it('should apply ONLY service area filter for proximity search (no distance provided)', async () => {
    // DTO default is 0, so strict check if undefined behaves like 0 is covered by DTO logic.
    // But let's testing passing explicitly undefined distance if possible, or just rely on default.
    // The DTO ensures distance is 0 if missing.
    const query: SearchQueryDto = { ...baseQuery, coords: [-93.2, 44.9] };

    await service.searchResources({
      headers: {} as any,
      query,
      tenant: {} as any,
    });

    const filters = getFiltersFromLastCall();
    const svcAreaFilter = filters.find(
      (f) => f.geo_shape && f.geo_shape.service_area,
    );
    expect(svcAreaFilter).toBeDefined();
    const boolFilter = filters.find((f) => f.bool && f.bool.should);
    expect(boolFilter).toBeUndefined();
  });

  it('should apply NO geo filters if no coords provided', async () => {
    const query: SearchQueryDto = { ...baseQuery, distance: 10 }; // Distance ignored without coords

    await service.searchResources({
      headers: {} as any,
      query,
      tenant: {} as any,
    });

    const filters = getFiltersFromLastCall();
    const svcAreaFilter = filters.find((f) => f.geo_shape);
    const boolFilter = filters.find((f) => f.bool && f.bool.should);

    expect(svcAreaFilter).toBeUndefined();
    expect(boolFilter).toBeUndefined();
  });
});
