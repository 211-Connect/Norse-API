import {
  SEARCH_PINS_LIMIT,
  toPinsRequest,
  toPinsResponse,
} from './search-pins';

const hit = (id: string, point: unknown) => ({
  _index: 'resources',
  _id: id,
  _source: {
    service_at_location_id: `sal-${id}`,
    name: `Resource ${id}`,
    location: { point, physical_address: { city: 'Richmond' } },
  },
});

const response = (hits: unknown[], total: unknown) =>
  ({ hits: { total, hits } }) as any;

describe('toPinsRequest', () => {
  it('drops facets and full documents, and keeps only located matches', () => {
    const request = toPinsRequest({
      index: 'resources',
      size: SEARCH_PINS_LIMIT,
      aggs: { facet: {} },
      _source_excludes: ['service_area'],
      query: { match_all: {} },
      sort: ['_score'],
    });

    expect(request.aggs).toBeUndefined();
    expect(request._source_excludes).toBeUndefined();
    expect(request._source).toContain('location.point');
    expect(request.query).toEqual({
      bool: {
        must: [{ match_all: {} }],
        filter: [{ exists: { field: 'location.point' } }],
      },
    });
    expect(request.sort).toEqual(['_score']);
  });
});

describe('toPinsResponse', () => {
  it('reads every stored point shape as longitude, latitude', () => {
    const { pins } = toPinsResponse(
      response(
        [
          hit('geojson', { type: 'Point', coordinates: [-77.4, 37.5] }),
          hit('object', { lat: 37.5, lon: -77.4 }),
          hit('array', [-77.4, 37.5]),
          hit('string', '37.5,-77.4'),
        ],
        { value: 4, relation: 'eq' },
      ),
    );

    expect(pins.map((pin) => pin.coordinates)).toEqual(
      Array(4).fill([-77.4, 37.5]),
    );
  });

  it('gives a point that cannot be read no pin', () => {
    const result = toPinsResponse(
      response([hit('located', [-77.4, 37.5]), hit('malformed', null)], 2),
    );

    expect(result.total).toBe(2);
    expect(result.pins.map((pin) => pin.id)).toEqual(['located']);
    expect(result.pins[0]).toMatchObject({
      service_at_location_id: 'sal-located',
      name: 'Resource located',
      physical_address: { city: 'Richmond' },
    });
  });

  it('reports truncation only past the limit', () => {
    expect(toPinsResponse(response([], SEARCH_PINS_LIMIT)).truncated).toBe(
      false,
    );
    expect(toPinsResponse(response([], SEARCH_PINS_LIMIT + 1)).truncated).toBe(
      true,
    );
  });
});
