import { Injectable } from '@nestjs/common';
import {
  SearchStrategy,
  SearchContext,
  WeightConfig,
} from './search-strategy.interface';
import { QueryBuilder } from '../builders/query.builder';

/**
 * Browse mode strategy
 * Returns all resources sorted by distance (if geo params) or alphabetically
 * Used when no query text and no taxonomy filters are provided
 */
@Injectable()
export class BrowseStrategy implements SearchStrategy {
  readonly name = 'browse_match_all';

  constructor(private readonly queryBuilder: QueryBuilder) {}

  canExecute(context: SearchContext): boolean {
    const normalizedQuery = context.searchRequest.q?.trim();
    const hasTaxonomies =
      context.searchRequest.taxonomies &&
      ((context.searchRequest.taxonomies.AND?.length || 0) > 0 ||
        (context.searchRequest.taxonomies.OR?.length || 0) > 0);

    // Execute only in browse mode: no query and no taxonomies
    return !normalizedQuery && !hasTaxonomies;
  }

  buildQuery(context: SearchContext): any {
    const hasGeoParams =
      context.searchRequest.lat !== undefined &&
      context.searchRequest.lon !== undefined;

    let sort: any[];
    if (hasGeoParams) {
      // Sort by distance from user location (closest first)
      sort = [
        {
          _geo_distance: {
            'location.point': {
              lat: context.searchRequest.lat,
              lon: context.searchRequest.lon,
            },
            order: 'asc',
            unit: 'mi',
            distance_type: 'arc',
          },
        },
        { _id: 'asc' }, // Tiebreaker
      ];
    } else {
      // Sort alphabetically by service name
      sort = [
        { 'service.name.keyword': 'asc' },
        { _id: 'asc' }, // Tiebreaker
      ];
    }

    return this.queryBuilder
      .reset()
      .withSize(context.k)
      .withMatchAll()
      .withFilters(context.filters)
      .withPagination(
        context.searchAfter,
        context.offset,
        context.useOffsetPagination,
      )
      .withSort(sort)
      .build();
  }

  getWeight(weights: WeightConfig): number {
    return 1.0; // Browse mode doesn't use weighting
  }
}
