import { Logger } from '@nestjs/common';
import { QueryEnhancementHandler } from './query-enhancement-handler.base';
import { SearchContext, SearchFeature } from '../types/search-context.interface';
import { NlpUtilsService } from 'src/common/services/nlp-utils.service';

export class SynonymExpansionHandler extends QueryEnhancementHandler {
  private readonly logger = new Logger(SynonymExpansionHandler.name);

  constructor(private readonly nlpUtils: NlpUtilsService) {
    super();
  }

  protected shouldProcess(context: SearchContext): boolean {
    return (
      context.features.has(SearchFeature.SYNONYMS) && !context.isCodeSearch
    );
  }

  protected async process(context: SearchContext): Promise<SearchContext> {
    // Find user query
    const userQuery = context.processedQueries.find((q) => q.type === 'user');
    if (!userQuery) return context;

    // Extract nouns and get synonyms
    const stemResult = this.nlpUtils.stemQueryForSuggestion(
      context.originalQuery,
    );

    if (stemResult.extractedNouns && stemResult.extractedNouns.length > 0) {
      const synonymPromises = stemResult.extractedNouns.map((noun) =>
        this.nlpUtils.getSynonyms(noun),
      );
      const synonymsArrays = await Promise.all(synonymPromises);
      const allSynonyms = [...new Set(synonymsArrays.flat())];

      // Add synonyms to user query
      if (allSynonyms.length > 0) {
        userQuery.query = `${userQuery.query} ${allSynonyms.join(' ')}`;
        this.logger.debug(
          `[v${context.version}] Expanded query with synonyms: "${userQuery.query}" (synonyms: [${allSynonyms.join(', ')}])`,
        );
      } else {
        this.logger.debug(
          `[v${context.version}] No synonyms found for query: "${userQuery.query}"`,
        );
      }
    }

    return context;
  }
}
