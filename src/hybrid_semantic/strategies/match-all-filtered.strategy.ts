import { Injectable } from '@nestjs/common';
import {
  SearchStrategy,
  SearchContext,
  WeightConfig,
} from './search-strategy.interface';
import { QueryBuilder } from '../builders/query.builder';

/**
 * Match-all filtered strategy
 * Used for taxonomy-only searches (no query text but has taxonomy filters)
 */
@Injectable()
export class MatchAllFilteredStrategy implements SearchStrategy {
  readonly name = 'match_all_filtered';

  constructor(private readonly queryBuilder: QueryBuilder) {}

  canExecute(context: SearchContext): boolean {
    const normalizedQuery = context.searchRequest.q?.trim();
    const hasTaxonomies =
      context.searchRequest.taxonomies &&
      ((context.searchRequest.taxonomies.AND?.length || 0) > 0 ||
        (context.searchRequest.taxonomies.OR?.length || 0) > 0);

    // Execute only for taxonomy-only searches: no query but has taxonomies
    return !normalizedQuery && hasTaxonomies;
  }

  buildQuery(context: SearchContext): any {
    return this.queryBuilder
      .reset()
      .withSize(context.k)
      .withMatchAll()
      .withFilters(context.filters)
      .withGeospatialScoring(context.searchRequest)
      .withPagination(
        context.searchAfter,
        context.offset,
        context.useOffsetPagination,
      )
      .build();
  }

  getWeight(weights: WeightConfig): number {
    return 1.0; // Match-all doesn't use weighting
  }
}
