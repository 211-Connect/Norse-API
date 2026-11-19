import { SearchUtilsService } from './search-utils.service';

// Geo filters built by SearchUtilsService.buildFilters, which both the keyword
// (SearchService) and hybrid (HybridSearchService) paths use.
//
// ISS-2755: in proximity mode a listing with no map point (`location.point`)
// used to pass every radius filter, so a point-less listing from anywhere in
// the tenant matched every proximity search. It now has to cover the search
// point with its service area instead.

const COORDS = [-74.89, 44.93];
const POINT = { type: 'point', coordinates: [-74.89, 44.93] };

const hasPoint = { exists: { field: 'location.point' } };

const withinRadius = (miles: number) => ({
  bool: {
    must: [
      hasPoint,
      {
        geo_distance: {
          distance: `${miles}miles`,
          'location.point': { lon: COORDS[0], lat: COORDS[1] },
        },
      },
    ],
  },
});

const serviceAreaContainsPoint = {
  geo_shape: {
    service_area: { shape: POINT, relation: 'contains' },
  },
};

const build = (
  distance: number,
  geoType: string | undefined,
  geometry?: any,
  coords: number[] | undefined = COORDS,
) =>
  SearchUtilsService.buildFilters(
    {},
    coords,
    distance,
    undefined,
    geoType,
    geometry,
  );

describe('SearchUtilsService.buildFilters geo filters', () => {
  describe('geo_type=proximity', () => {
    it('admits a point-less listing only when its service area contains the search point', () => {
      expect(build(25, 'proximity')).toEqual([
        {
          bool: {
            should: [
              withinRadius(25),
              {
                bool: {
                  must_not: hasPoint,
                  filter: serviceAreaContainsPoint,
                },
              },
            ],
          },
        },
      ]);
    });

    it('adds no geo filter without a distance (unchanged)', () => {
      expect(build(0, 'proximity')).toEqual([]);
    });
  });

  // Default mode and boundary mode are pinned whole: ISS-2755 must not change them.
  describe('default mode (no geo_type), unchanged', () => {
    it('keeps service-area containment AND (radius OR no point)', () => {
      expect(build(25, undefined)).toEqual([
        serviceAreaContainsPoint,
        {
          bool: {
            should: [withinRadius(25), { bool: { must_not: hasPoint } }],
          },
        },
      ]);
    });

    it('keeps only service-area containment without a distance', () => {
      expect(build(0, undefined)).toEqual([serviceAreaContainsPoint]);
    });
  });

  describe('geo_type=boundary, unchanged', () => {
    it('keeps the service-area intersects filter and nothing else', () => {
      const geometry = {
        type: 'Polygon',
        coordinates: [
          [
            [-75, 44],
            [-74, 44],
            [-74, 45],
            [-75, 45],
            [-75, 44],
          ],
        ],
      };

      expect(build(25, 'boundary', geometry)).toEqual([
        {
          geo_shape: {
            service_area: { shape: geometry, relation: 'intersects' },
          },
        },
      ]);
    });
  });
});
