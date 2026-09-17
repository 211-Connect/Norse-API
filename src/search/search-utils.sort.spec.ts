import { SearchUtilsService } from './search-utils.service';
import { QueryType } from './search.service';
import { SearchResourcesQueryDto } from './dto/search-query.dto';

type SortOption = SearchResourcesQueryDto['sort'];

const PRIORITY = { priority: 'desc' };
const TIEBREAKER = { 'service_at_location_id.raw': { order: 'asc' } };
const COORDS = [-76.6, 39.3];

describe('SearchUtilsService.buildSort', () => {
  describe('the relevance tier (regression guard for 6304ee1)', () => {
    it('ranks a keyword search by _score, between priority and the tiebreaker', () => {
      expect(
        SearchUtilsService.buildSort(undefined, 'relevance', 'keyword'),
      ).toEqual([PRIORITY, '_score', TIEBREAKER]);
    });

    it('keeps _score for match_all so an empty query is still ordered', () => {
      expect(
        SearchUtilsService.buildSort(undefined, 'relevance', 'match_all'),
      ).toEqual([PRIORITY, '_score', TIEBREAKER]);
    });

    it('puts priority ahead of _score so pinned resources still lead', () => {
      const sort = SearchUtilsService.buildSort(
        undefined,
        'relevance',
        'keyword',
      ) as unknown[];

      expect(sort[0]).toEqual(PRIORITY);
      expect(sort[1]).toBe('_score');
    });

    it('falls back to _score for sort=distance with no coords', () => {
      expect(
        SearchUtilsService.buildSort(undefined, 'distance', 'keyword'),
      ).toEqual([PRIORITY, '_score', TIEBREAKER]);
    });
  });

  describe('explicit ordering options', () => {
    it('sorts by name', () => {
      expect(
        SearchUtilsService.buildSort(undefined, 'name', 'keyword'),
      ).toEqual([PRIORITY, { 'name.raw': { order: 'asc' } }, TIEBREAKER]);
    });

    it('sorts by organization then name', () => {
      expect(
        SearchUtilsService.buildSort(undefined, 'organization', 'keyword'),
      ).toEqual([
        PRIORITY,
        { 'organization.name.raw': { order: 'asc' } },
        { 'name.raw': { order: 'asc' } },
        TIEBREAKER,
      ]);
    });

    it('sorts by distance when coords are supplied', () => {
      const sort = SearchUtilsService.buildSort(
        COORDS,
        'distance',
        'keyword',
      ) as Record<string, unknown>[];

      expect(sort[0]).toEqual(PRIORITY);
      expect(sort[1]).toHaveProperty('_geo_distance');
      expect(sort[sort.length - 1]).toEqual(TIEBREAKER);
    });
  });

  describe('taxonomy', () => {
    it('orders by the tiebreaker alone when there are no coords', () => {
      expect(
        SearchUtilsService.buildSort(undefined, 'relevance', 'taxonomy'),
      ).toEqual([PRIORITY, TIEBREAKER]);
    });

    it('orders nearest-first when coords are supplied', () => {
      const sort = SearchUtilsService.buildSort(
        COORDS,
        'relevance',
        'taxonomy',
      ) as Record<string, unknown>[];

      expect(sort[1]).toHaveProperty('_geo_distance');
      expect(sort[sort.length - 1]).toEqual(TIEBREAKER);
    });

    it('does not add _score, which carries no signal for taxonomy matching', () => {
      expect(
        SearchUtilsService.buildSort(undefined, 'relevance', 'taxonomy'),
      ).not.toContain('_score');
    });
  });

  // The property that makes pagination safe: whatever the caller asks for,
  // the clause must end in a key that is unique per document. Without it a tie
  // is broken by Lucene doc order, which differs per replica shard.
  describe('every sort clause ends with a unique tiebreaker', () => {
    const sortOptions: SortOption[] = [
      'relevance',
      'distance',
      'name',
      'organization',
    ];
    const queryTypes: QueryType[] = [
      'match_all',
      'keyword',
      'taxonomy',
      'more_like_this',
    ];

    const cases = sortOptions.flatMap((sortOption) =>
      queryTypes.flatMap((queryType) =>
        [undefined, COORDS].map((coords) => ({
          sortOption,
          queryType,
          coords,
        })),
      ),
    );

    it.each(cases)(
      'sort=$sortOption query_type=$queryType coords=$coords',
      ({ sortOption, queryType, coords }) => {
        const sort = SearchUtilsService.buildSort(
          coords,
          sortOption,
          queryType,
        ) as Record<string, unknown>[];

        expect(sort.length).toBeGreaterThan(1);
        expect(sort[sort.length - 1]).toEqual(TIEBREAKER);
      },
    );
  });
});
