import { SearchUtilsService } from './search-utils.service';
import { AreaFilter } from './internal/area/area-match';

const shape = (field: string, id: string) => ({
  geo_shape: {
    [field]: {
      indexed_shape: { index: 'regions', id, path: 'geometry' },
      relation: 'intersects',
    },
  },
});
const located = (id: string) => shape('location.point', id);
const serving = (id: string) => shape('service_area', id);
const hasLocation = { exists: { field: 'location.point' } };
const hasServiceArea = { exists: { field: 'service_area' } };
const unlocated = { bool: { must_not: [hasLocation, hasServiceArea] } };

const area = (overrides: Partial<AreaFilter> = {}): AreaFilter => ({
  regionIds: ['county:53033'],
  match: 'located_or_serving',
  includeUnlocated: false,
  ...overrides,
});

describe('SearchUtilsService.buildRegionFilter (area search)', () => {
  it('located: only a location inside the Region matches', () => {
    expect(
      SearchUtilsService.buildRegionFilter(area({ match: 'located' })),
    ).toEqual({
      bool: { should: [located('county:53033')], minimum_should_match: 1 },
    });
  });

  it('located_or_serving: a resource with no location is judged by its service area', () => {
    expect(SearchUtilsService.buildRegionFilter(area())).toEqual({
      bool: {
        should: [
          located('county:53033'),
          {
            bool: {
              must_not: [hasLocation],
              should: [serving('county:53033')],
              minimum_should_match: 1,
            },
          },
        ],
        minimum_should_match: 1,
      },
    });
  });

  it('serving: a location inside OR a service area overlapping the Region', () => {
    expect(
      SearchUtilsService.buildRegionFilter(area({ match: 'serving' })),
    ).toEqual({
      bool: {
        should: [located('county:53033'), serving('county:53033')],
        minimum_should_match: 1,
      },
    });
  });

  it.each(['located', 'located_or_serving', 'serving'] as const)(
    '%s with include_unlocated also matches resources with neither field',
    (match) => {
      const filter = SearchUtilsService.buildRegionFilter(
        area({ match, includeUnlocated: true }),
      ) as { bool: { should: unknown[] } };
      expect(filter.bool.should[filter.bool.should.length - 1]).toEqual(
        unlocated,
      );
    },
  );

  it('matches any of several Regions', () => {
    const filter = SearchUtilsService.buildRegionFilter(
      area({ regionIds: ['county:53033', 'county:53053'], match: 'serving' }),
    );
    expect(filter).toEqual({
      bool: {
        should: [
          located('county:53033'),
          located('county:53053'),
          serving('county:53033'),
          serving('county:53053'),
        ],
        minimum_should_match: 1,
      },
    });
  });
});

describe('SearchUtilsService.buildFilters with an area', () => {
  it('replaces the coords, radius and geo_type rules', () => {
    const filters = SearchUtilsService.buildFilters(
      {},
      [-122.3, 47.6],
      25,
      undefined,
      'proximity',
      undefined,
      undefined,
      area(),
    );
    expect(filters).toEqual([SearchUtilsService.buildRegionFilter(area())]);
  });

  it('keeps the organization scope', () => {
    const filters = SearchUtilsService.buildFilters(
      {},
      undefined,
      0,
      undefined,
      undefined,
      undefined,
      'org-1',
      area(),
    );
    expect(filters[0]).toEqual({ term: { 'organization.id': 'org-1' } });
    expect(filters).toHaveLength(2);
  });

  it('builds the same filters as before without an area', () => {
    const build = (...rest: [undefined?, undefined?, undefined?]) =>
      SearchUtilsService.buildFilters(
        {},
        [-122.3, 47.6],
        25,
        undefined,
        undefined,
        ...rest,
      );
    expect(build(undefined, undefined, undefined)).toEqual(build(undefined));
  });
});
