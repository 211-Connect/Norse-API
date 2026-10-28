import { BadRequestException } from '@nestjs/common';
import { SearchLocationService } from './search-location.service';
import { SearchResourcesQueryDto } from '../../dto/search-query.dto';

const query = (fields: Partial<SearchResourcesQueryDto>) =>
  ({ query: '', distance: 10, ...fields }) as SearchResourcesQueryDto;
const hit = (fields: object) => ({
  type: 'coordinates',
  address: 'x',
  coordinates: [-120.5, 46.6],
  ...fields,
});
const YAKIMA_COUNTY = {
  id: 'county:53077',
  type: 'county',
  name: 'Yakima County, WA',
  state: 'WA',
};
const RESOLVED_YAKIMA = {
  id: 'county:53077',
  type: 'county',
  name: 'Yakima County, WA',
};

describe('SearchLocationService', () => {
  const regionService = { getSummaries: jest.fn() };
  const geocodingService = { forwardGeocode: jest.fn() };
  const service = new SearchLocationService(
    regionService as never,
    geocodingService as never,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    regionService.getSummaries.mockResolvedValue([YAKIMA_COUNTY]);
  });

  it('passes a query with no region or location through untouched', async () => {
    const q = query({ coords: [-120.5, 46.6] });
    expect(await service.resolve(q)).toEqual({ query: q });
    expect(geocodingService.forwardGeocode).not.toHaveBeenCalled();
  });

  it('searches region ids as given, without a radius, and echoes them', async () => {
    const result = await service.resolve(
      query({ region: ['county:53077'], coords: [-120.5, 46.6] }),
    );
    expect(result.query.region).toEqual(['county:53077']);
    expect(result.query.distance).toBe(0);
    expect(result.resolved).toEqual({
      regions: [RESOLVED_YAKIMA],
      coords: [-120.5, 46.6],
    });
  });

  it('lets an unknown region id fail the search', async () => {
    regionService.getSummaries.mockRejectedValue(new BadRequestException());
    await expect(
      service.resolve(query({ region: ['county:00000'] })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ignores location when coords are sent', async () => {
    const q = query({ coords: [-120.5, 46.6], location: 'Yakima, WA' });
    expect(await service.resolve(q)).toEqual({ query: q });
    expect(geocodingService.forwardGeocode).not.toHaveBeenCalled();
  });

  it("searches an area location as the geocoder hit's Region", async () => {
    geocodingService.forwardGeocode.mockResolvedValue([
      hit({ region_id: 'county:53077' }),
    ]);

    const result = await service.resolve(query({ location: 'Yakima' }));

    expect(result.query).toMatchObject({
      region: ['county:53077'],
      coords: [-120.5, 46.6],
      distance: 0,
    });
    expect(result.resolved).toEqual({
      input: 'Yakima',
      regions: [RESOLVED_YAKIMA],
      coords: [-120.5, 46.6],
    });
  });

  it('searches an address location as a point with the given distance', async () => {
    geocodingService.forwardGeocode.mockResolvedValue([
      hit({ region_id: null }),
    ]);

    const result = await service.resolve(
      query({ location: '1 Main St, Yakima' }),
    );

    expect(result.query.coords).toEqual([-120.5, 46.6]);
    expect(result.query.distance).toBe(10);
    expect(result.query.region).toBeUndefined();
    expect(result.resolved?.regions).toEqual([]);
  });

  it('keeps only hits in the given state', async () => {
    geocodingService.forwardGeocode.mockResolvedValue([
      hit({ state_code: 'IN', coordinates: [1, 1] }),
      hit({ state_code: 'MD', coordinates: [2, 2] }),
    ]);

    const result = await service.resolve(
      query({ location: '21021', state: 'MD' }),
    );

    expect(geocodingService.forwardGeocode).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 }),
    );
    expect(result.query.coords).toEqual([2, 2]);
  });

  it('is a 400 when nothing resolves in the state', async () => {
    geocodingService.forwardGeocode.mockResolvedValue([
      hit({ state_code: 'IN' }),
    ]);
    await expect(
      service.resolve(query({ location: '21021', state: 'MD' })),
    ).rejects.toThrow('Could not resolve location "21021" in MD');
  });
});
