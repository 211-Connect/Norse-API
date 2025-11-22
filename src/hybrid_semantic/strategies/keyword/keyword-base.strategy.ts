import {
  SearchStrategy,
  SearchContext,
  WeightConfig,
} from '../search-strategy.interface';
import { QueryBuilder } from '../../builders/query.builder';
import { WeightResolver } from '../../resolvers/weight.resolver';
import { WeightsConfigService } from '../../config/weights-config.service';

/**
 * Base class for keyword search strategies
 * Provides common functionality for all keyword variations
 */
export abstract class KeywordBaseStrategy implements SearchStrategy {
  abstract readonly name: string;
  protected abstract readonly variationType:
    | 'original'
    | 'nouns'
    | 'nouns_stemmed'
    | 'synonyms'
    | 'topics';

  constructor(
    protected readonly queryBuilder: QueryBuilder,
    protected readonly weightResolver: WeightResolver,
    protected readonly weightsConfigService: WeightsConfigService,
  ) {}

  abstract canExecute(context: SearchContext): boolean;

  buildQuery(context: SearchContext): any {
    const queryText = this.getQueryText(context);
    if (!queryText) {
      throw new Error(`No query text available for ${this.name}`);
    }

    const weights = this.weightResolver.resolve(context.searchRequest);
    const weight = this.getWeight(weights);

    // Fields to search across
    const fields = [
      'name^3',
      'description^2',
      'summary',
      'service.name^3',
      'service.description^2',
      'organization.name^2',
      'taxonomies.name',
      'taxonomies.description',
    ];

    // Determine operator based on variation type
    const operator = this.getOperator();

    return this.queryBuilder
      .reset()
      .withSize(context.k)
      .withMultiMatch(queryText, fields, operator)
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
    const baseWeight = weights.strategies.keyword_search;
    const multipliers =
      this.weightsConfigService.getKeywordVariationMultipliers();

    switch (this.variationType) {
      case 'original':
        return baseWeight; // Full weight for original query
      case 'nouns':
        return baseWeight * multipliers.nouns_multiplier;
      case 'nouns_stemmed':
        return baseWeight * multipliers.stemmed_nouns_multiplier;
      case 'synonyms':
        return baseWeight * multipliers.stemmed_nouns_multiplier;
      case 'topics':
        return baseWeight * multipliers.nouns_multiplier * 1.1; // Boost topics
      default:
        return baseWeight;
    }
  }

  /**
   * Get the query text for this variation from the context
   */
  protected abstract getQueryText(context: SearchContext): string | null;

  /**
   * Get the match operator for this variation
   */
  protected getOperator(): 'and' | 'or' {
    // Original query uses AND for precision
    // Other variations use OR for recall
    return this.variationType === 'original' ? 'and' : 'or';
  }
}
