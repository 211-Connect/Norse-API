import { Injectable } from '@nestjs/common';
import {
  SearchStrategy,
  SearchContext,
  WeightConfig,
} from './search-strategy.interface';
import { QueryBuilder } from '../builders/query.builder';
import { WeightResolver } from '../resolvers/weight.resolver';

/**
 * Intent-driven taxonomy search strategy
 * Searches for services matching taxonomy codes from intent classification
 */
@Injectable()
export class IntentTaxonomyStrategy implements SearchStrategy {
  readonly name = 'intent_taxonomy';

  constructor(
    private readonly queryBuilder: QueryBuilder,
    private readonly weightResolver: WeightResolver,
  ) {}

  canExecute(context: SearchContext): boolean {
    // Only execute if we have intent classification with taxonomy codes
    // and it's not a low-information query
    return (
      !!context.intentClassification &&
      !!context.intentClassification.combined_taxonomy_codes &&
      context.intentClassification.combined_taxonomy_codes.length > 0 &&
      !context.intentClassification.is_low_information_query
    );
  }

  buildQuery(context: SearchContext): any {
    const taxonomyCodes =
      context.intentClassification!.combined_taxonomy_codes;
    const weights = this.weightResolver.resolve(context.searchRequest);
    const weight = this.getWeight(weights);

    return this.queryBuilder
      .reset()
      .withSize(context.k)
      .withTaxonomyTerms(taxonomyCodes)
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
    return weights.strategies.intent_driven;
  }
}
