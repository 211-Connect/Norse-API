import { Injectable } from '@nestjs/common';
import { SearchContext } from '../search-strategy.interface';
import { KeywordBaseStrategy } from './keyword-base.strategy';

/**
 * Nouns-only keyword search strategy
 * Focuses on core concepts extracted via POS tagging
 */
@Injectable()
export class KeywordNounsStrategy extends KeywordBaseStrategy {
  readonly name = 'keyword_nouns';
  protected readonly variationType = 'nouns' as const;

  canExecute(context: SearchContext): boolean {
    // Execute if we have nouns and intent classification is not disabled
    return (
      !context.searchRequest.disable_intent_classification &&
      !!context.keywordVariations?.nouns &&
      context.keywordVariations.nouns.length > 0
    );
  }

  protected getQueryText(context: SearchContext): string | null {
    const nouns = context.keywordVariations?.nouns;
    return nouns && nouns.length > 0 ? nouns.join(' ') : null;
  }
}
