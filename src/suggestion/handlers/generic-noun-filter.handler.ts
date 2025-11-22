import { Logger } from '@nestjs/common';
import { QueryEnhancementHandler } from './query-enhancement-handler.base';
import { SearchContext, SearchFeature } from '../types/search-context.interface';
import { NlpUtilsService } from 'src/common/services/nlp-utils.service';

export class GenericNounFilterHandler extends QueryEnhancementHandler {
  private readonly logger = new Logger(GenericNounFilterHandler.name);

  constructor(private readonly nlpUtils: NlpUtilsService) {
    super();
  }

  protected shouldProcess(context: SearchContext): boolean {
    return context.features.has(SearchFeature.GENERIC_NOUN_FILTERING);
  }

  protected async process(context: SearchContext): Promise<SearchContext> {
    const originalCount = context.processedQueries.length;

    // Filter out queries that only contain generic nouns
    context.processedQueries = context.processedQueries.filter((pq) => {
      const terms = pq.query.split(/\s+/);
      const nonGenericTerms = this.nlpUtils.filterGenericNouns(terms);
      const hasNonGeneric = nonGenericTerms.length > 0;

      if (!hasNonGeneric) {
        this.logger.debug(
          `[v${context.version}] Filtered out query with only generic nouns: "${pq.query}" (type: ${pq.type})`,
        );
      }

      return hasNonGeneric;
    });

    const filteredCount = originalCount - context.processedQueries.length;
    if (filteredCount > 0) {
      this.logger.debug(
        `[v${context.version}] Filtered ${filteredCount} queries containing only generic nouns`,
      );
    }

    return context;
  }
}
