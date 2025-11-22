import { Injectable } from '@nestjs/common';
import { SearchContext } from '../search-strategy.interface';
import { KeywordBaseStrategy } from './keyword-base.strategy';

/**
 * Stemmed nouns keyword search strategy
 * Catches corpus variations (e.g., "laundry" vs "laundri")
 */
@Injectable()
export class KeywordStemmedStrategy extends KeywordBaseStrategy {
  readonly name = 'keyword_nouns_stemmed';
  protected readonly variationType = 'nouns_stemmed' as const;

  canExecute(context: SearchContext): boolean {
    // Execute if we have stemmed nouns and intent classification is not disabled
    return (
      !context.searchRequest.disable_intent_classification &&
      !!context.keywordVariations?.stemmedNouns &&
      context.keywordVariations.stemmedNouns.length > 0
    );
  }

  protected getQueryText(context: SearchContext): string | null {
    const stemmedNouns = context.keywordVariations?.stemmedNouns;
    return stemmedNouns && stemmedNouns.length > 0
      ? stemmedNouns.join(' ')
      : null;
  }
}
