import { SearchStrategy } from './search-strategy.interface';
import { SearchFeature } from '../types/search-context.interface';
import { QueryEnhancementHandler } from '../handlers/query-enhancement-handler.base';
import { CodeDetectionHandler } from '../handlers/code-detection.handler';
import { StemmingHandler } from '../handlers/stemming.handler';
import { SynonymExpansionHandler } from '../handlers/synonym-expansion.handler';
import { IntentClassificationHandler } from '../handlers/intent-classification.handler';
import { GenericNounFilterHandler } from '../handlers/generic-noun-filter.handler';
import { NlpUtilsService } from 'src/common/services/nlp-utils.service';
import { AiUtilsService } from 'src/common/services/ai-utils.service';

export class V2SearchStrategy implements SearchStrategy {
  getEnabledFeatures(): Set<SearchFeature> {
    // V2: All advanced features
    return new Set([
      SearchFeature.STEMMING,
      SearchFeature.SYNONYMS,
      SearchFeature.INTENT_CLASSIFICATION,
      SearchFeature.GENERIC_NOUN_FILTERING,
      SearchFeature.FUZZY_MATCHING,
    ]);
  }

  buildPipeline(
    nlpUtils: NlpUtilsService,
    aiUtils: AiUtilsService,
  ): QueryEnhancementHandler {
    const codeDetection = new CodeDetectionHandler();
    const stemming = new StemmingHandler(nlpUtils);
    const synonyms = new SynonymExpansionHandler(nlpUtils);
    const intent = new IntentClassificationHandler(aiUtils, nlpUtils);
    const genericFilter = new GenericNounFilterHandler(nlpUtils);

    codeDetection
      .setNext(stemming)
      .setNext(synonyms)
      .setNext(intent)
      .setNext(genericFilter);

    return codeDetection;
  }
}
