import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ForwardGeocodeQueryDto, GeocodingProvider } from './dto/geocoding.dto';
import { GeocodingService } from './geocoding.service';
import { IGeocodingProvider } from './providers/geocoding-provider.interface';

const dto = (query: Record<string, unknown>) =>
  plainToInstance(ForwardGeocodeQueryDto, query);

describe('ForwardGeocodeQueryDto types and proximity (ISS-1875)', () => {
  it('reads types as a comma-separated list of Mapbox place types', async () => {
    const query = dto({ address: 'Main St', types: 'address,poi' });
    expect(await validate(query)).toEqual([]);
    expect(query.types).toEqual(['address', 'poi']);
  });

  it('also reads types sent as a repeated param, as an SDK may send an array', async () => {
    const query = dto({ address: 'x', types: ['address', 'poi'] });
    expect(await validate(query)).toEqual([]);
    expect(query.types).toEqual(['address', 'poi']);
  });

  it('refuses a type Mapbox does not have', async () => {
    const errors = await validate(dto({ address: 'x', types: 'address,city' }));
    expect(errors.map((e) => e.property)).toEqual(['types']);
  });

  it('reads proximity as longitude,latitude', async () => {
    const query = dto({ address: 'x', proximity: '-78.8986,35.994' });
    expect(await validate(query)).toEqual([]);
    expect(query.proximity).toEqual([-78.8986, 35.994]);
  });

  it.each(['35.994', '-181,35', '-78.9,91', 'a,b', '-78.9,', ',35.9'])(
    'refuses proximity %s',
    async (proximity) => {
      const errors = await validate(dto({ address: 'x', proximity }));
      expect(errors.map((e) => e.property)).toEqual(['proximity']);
    },
  );
});

describe('GeocodingService.forwardGeocode (ISS-1875)', () => {
  const mapbox = { forwardGeocode: jest.fn(), reverseGeocode: jest.fn() };
  const opencage = { forwardGeocode: jest.fn(), reverseGeocode: jest.fn() };
  const store = new Map<string, unknown>();
  const cache = {
    get: jest.fn(async (k: string) => store.get(k)),
    set: jest.fn(async (k: string, v: unknown) => void store.set(k, v)),
  };
  const service = new GeocodingService(
    {
      [GeocodingProvider.MAPBOX]: mapbox as IGeocodingProvider,
      [GeocodingProvider.OPENCAGE]: opencage as IGeocodingProvider,
    },
    cache as never,
  );

  beforeEach(() => {
    store.clear();
    jest.clearAllMocks();
    mapbox.forwardGeocode.mockResolvedValue([]);
  });

  it('keys the cache by types and proximity, so a filtered answer never serves an unfiltered one', async () => {
    await service.forwardGeocode(dto({ address: 'Main St' }));
    await service.forwardGeocode(dto({ address: 'Main St', types: 'address' }));
    await service.forwardGeocode(
      dto({ address: 'Main St', types: 'address', proximity: '-78.9,35.9' }),
    );
    await service.forwardGeocode(
      dto({ address: 'Main St', types: 'address', proximity: '-78.9,35.9' }),
    );
    expect(mapbox.forwardGeocode).toHaveBeenCalledTimes(3);
  });

  it('shares a cache entry for proximities within about 100 m, and ignores proximity for OpenCage', async () => {
    await service.forwardGeocode(
      dto({ address: 'x', proximity: '-78.89861,35.99401' }),
    );
    await service.forwardGeocode(
      dto({ address: 'x', proximity: '-78.89859,35.99399' }),
    );
    expect(mapbox.forwardGeocode).toHaveBeenCalledTimes(1);

    opencage.forwardGeocode.mockResolvedValue([]);
    await service.forwardGeocode(dto({ address: 'y', provider: 'opencage' }));
    await service.forwardGeocode(
      dto({ address: 'y', provider: 'opencage', proximity: '-78.9,35.9' }),
    );
    expect(opencage.forwardGeocode).toHaveBeenCalledTimes(1);
  });

  it('treats the same types in another order as the same query', async () => {
    await service.forwardGeocode(dto({ address: 'x', types: 'poi,address' }));
    await service.forwardGeocode(dto({ address: 'x', types: 'address,poi' }));
    expect(mapbox.forwardGeocode).toHaveBeenCalledTimes(1);
  });

  it('refuses types for OpenCage, whose vocabulary differs, with 400', async () => {
    await expect(
      service.forwardGeocode(
        dto({ address: 'x', provider: 'opencage', types: 'address' }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(opencage.forwardGeocode).not.toHaveBeenCalled();
  });
});
