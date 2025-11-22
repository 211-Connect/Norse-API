import { Logger } from '@nestjs/common';
import { QueryEnhancementHandler } from './query-enhancement-handler.base';
import { SearchContext, SearchFeature } from '../types/search-context.interface';
import { AiUtilsService } from 'src/common/services/ai-utils.service';
import { NlpUtilsService } from 'src/common/services/nlp-utils.service';

export class IntentClassificationHandler extends QueryEnhancementHandler {
  private readonly logger = new Logger(IntentClassificationHandler.name);

  constructor(
    private readonly aiUtils: AiUtilsService,
    private readonly nlpUtils: NlpUtilsService,
  ) {
    super();
  }

  protected shouldProcess(context: SearchContext): boolean {
    if (!context.features.has(SearchFeature.INTENT_CLASSIFICATION)) {
      return false;
    }

    if (context.isCodeSearch || context.disableIntentClassification) {
      return false;
    }

    // Skip for short queries (1-2 words)
    const wordCount = context.originalQuery.trim().split(/\s+/).length;
    if (wordCount <= 2) {
      this.logger.debug(
        `[v${context.version}] Skipping intent classification for ${wordCount}-word query: "${context.originalQuery}"`,
      );
      return false;
    }

    return true;
  }

  protected async process(context: SearchContext): Promise<SearchContext> {
    try {
      const classification =
        await this.aiUtils.classifyQuery(context.originalQuery);

      if (classification.primary_intent) {
        context.intentClassification = classification;

        this.logger.debug(
          `[v${context.version}] Intent classification: "${classification.primary_intent}" (confidence: ${classification.confidence})`,
        );

        // Extract intent search terms
        const intentTerms = this.extractIntentSearchTerms(
          classification.primary_intent,
          context,
        );

        // Add intent queries
        intentTerms.forEach((term) => {
          context.processedQueries.push({
            query: term,
            type: 'intent',
            source: classification.primary_intent,
          });
        });

        this.logger.debug(
          `[v${context.version}] Added ${intentTerms.length} intent-based queries: [${intentTerms.join(', ')}]`,
        );
      } else {
        this.logger.debug(
          `[v${context.version}] No primary intent found, continuing without intent classification`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `[v${context.version}] Intent classification failed: ${error.message}, continuing without intent classification`,
      );
    }

    return context;
  }

  private extractIntentSearchTerms(
    intentName: string,
    context: SearchContext,
  ): string[] {
    // Apply NLP preprocessing to intent name
    const stemResult = this.nlpUtils.stemQueryForSuggestion(intentName);

    if (stemResult.shouldUseStemmed && stemResult.stemmed) {
      // Split stemmed result into individual terms
      const terms = stemResult.stemmed.split(/\s+/).filter((t) => t.length > 0);

      // Filter out generic nouns from intent terms
      const filteredTerms = this.nlpUtils.filterGenericNouns(terms);

      this.logger.debug(
        `[v${context.version}] Intent preprocessing: "${intentName}" -> [${terms.join(', ')}] -> filtered: [${filteredTerms.join(', ')}]`,
      );

      return filteredTerms;
    }

    // If no stemming benefit, return lowercase version as single term
    // But still check if it's generic
    const lowercaseTerm = intentName.toLowerCase();
    if (this.nlpUtils.isGenericNoun(lowercaseTerm)) {
      this.logger.debug(
        `[v${context.version}] Intent term "${intentName}" is generic, filtering out`,
      );
      return [];
    }

    return [lowercaseTerm];
  }
}
