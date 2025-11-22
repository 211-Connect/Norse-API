import { Injectable } from '@nestjs/common';
import { SearchContext } from '../search-strategy.interface';
import { KeywordBaseStrategy } from './keyword-base.strategy';

/**
 * Topics keyword search strategy
 * Highly specific entities (people, places, organizations)
 */
@Injectable()
export class KeywordTopicsStrategy extends KeywordBaseStrategy {
  readonly name = 'keyword_topics';
  protected readonly variationType = 'topics' as const;

  canExecute(context: SearchContext): boolean {
    // Execute if we have topics and intent classification is not disabled
    return (
      !context.searchRequest.disable_intent_classification &&
      !!context.keywordVariations?.topics &&
      context.keywordVariations.topics.length > 0
    );
  }

  protected getQueryText(context: SearchContext): string | null {
    const topics = context.keywordVariations?.topics;
    return topics && topics.length > 0 ? topics.join(' ') : null;
  }
}
