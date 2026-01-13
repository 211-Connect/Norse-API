import { Injectable } from '@nestjs/common';
import {
  SearchStrategy,
  SearchContext,
  WeightConfig,
} from '../search-strategy.interface';
import { QueryBuilder } from '../../builders/query.builder';
import { WeightResolver } from '../../resolvers/weight.resolver';

/**
 * Taxonomy-level semantic search strategy
 * Uses KNN on taxonomies[].embedding field combined with geospatial scoring
 */
@Injectable()
export class SemanticTaxonomyStrategy implements SearchStrategy {
  readonly name = 'semantic_taxonomy';

  constructor(
    private readonly queryBuilder: QueryBuilder,
    private readonly weightResolver: WeightResolver,
  ) {}

  canExecute(context: SearchContext): boolean {
    // Only execute if we have a query embedding
    return !!context.embedding && context.embedding.length > 0;
  }

  buildQuery(context: SearchContext): any {
    const weights = this.weightResolver.resolve(context.searchRequest);
    const weight = this.getWeight(weights);

    return this.queryBuilder
      .reset()
      .withSize(context.k)
      .withNestedKnn(
        'taxonomies',
        'taxonomies.embedding',
        context.embedding!,
        context.k,
      )
      .withFilters(context.filters)
      .withGeospatialScoring(context.searchRequest)
      .withPagination(
        context.searchAfter,
        context.offset,
        context.useOffsetPagination,
      )
      .withWeight(weight)
      .build();
  }

  getWeight(weights: WeightConfig): number {
    return weights.semantic.taxonomy * weights.strategies.semantic_search;
  }
}
