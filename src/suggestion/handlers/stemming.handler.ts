import { Logger } from '@nestjs/common';
import { QueryEnhancementHandler } from './query-enhancement-handler.base';
import { SearchContext, SearchFeature } from '../types/search-context.interface';
import { NlpUtilsService } from 'src/common/services/nlp-utils.service';

export class StemmingHandler extends QueryEnhancementHandler {
  private readonly logger = new Logger(StemmingHandler.name);

  constructor(private readonly nlpUtils: NlpUtilsService) {
    super();
  }

  protected shouldProcess(context: SearchContext): boolean {
    return (
      context.features.has(SearchFeature.STEMMING) && !context.isCodeSearch
    );
  }

  protected async process(context: SearchContext): Promise<SearchContext> {
    const stemResult =
      this.nlpUtils.stemQueryForSuggestion(context.originalQuery);

    if (stemResult.shouldUseStemmed && stemResult.stemmed) {
      // Replace the user query with stemmed version
      const userQueryIndex = context.processedQueries.findIndex(
        (q) => q.type === 'user',
      );

      if (userQueryIndex >= 0) {
        context.processedQueries[userQueryIndex] = {
          query: stemResult.stemmed,
          type: 'user',
          source: 'stemmed',
        };

        this.logger.debug(
          `[v${context.version}] Using stemmed query: "${stemResult.stemmed}" (from: "${context.originalQuery}")`,
        );
      }
    } else {
      this.logger.debug(
        `[v${context.version}] Using original query (no stemming benefit): "${context.originalQuery}"`,
      );
    }

    return context;
  }
}
