import { Injectable } from '@nestjs/common';
import { SearchContext } from '../search-strategy.interface';
import { KeywordBaseStrategy } from './keyword-base.strategy';

/**
 * Synonyms keyword search strategy
 * Catches alternative phrasings via WordNet
 */
@Injectable()
export class KeywordSynonymsStrategy extends KeywordBaseStrategy {
  readonly name = 'keyword_synonyms';
  protected readonly variationType = 'synonyms' as const;

  canExecute(context: SearchContext): boolean {
    // Execute if we have synonyms and intent classification is not disabled
    return (
      !context.searchRequest.disable_intent_classification &&
      !!context.keywordVariations?.synonyms &&
      context.keywordVariations.synonyms.length > 0
    );
  }

  protected getQueryText(context: SearchContext): string | null {
    const synonyms = context.keywordVariations?.synonyms;
    return synonyms && synonyms.length > 0 ? synonyms.join(' ') : null;
  }
}
