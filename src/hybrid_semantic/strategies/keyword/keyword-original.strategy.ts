import { Injectable } from '@nestjs/common';
import { SearchContext } from '../search-strategy.interface';
import { KeywordBaseStrategy } from './keyword-base.strategy';

/**
 * Original query keyword search strategy
 * Preserves full user intent and phrases with contractions expanded
 */
@Injectable()
export class KeywordOriginalStrategy extends KeywordBaseStrategy {
  readonly name = 'keyword_original';
  protected readonly variationType = 'original' as const;

  canExecute(context: SearchContext): boolean {
    // Execute if we have keyword variations and intent classification is not disabled
    return (
      !context.searchRequest.disable_intent_classification &&
      !!context.keywordVariations?.original
    );
  }

  protected getQueryText(context: SearchContext): string | null {
    return context.keywordVariations?.original || null;
  }
}
