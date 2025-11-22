import { SearchStrategy } from './search-strategy.interface';
import { SearchFeature } from '../types/search-context.interface';
import { QueryEnhancementHandler } from '../handlers/query-enhancement-handler.base';
import { CodeDetectionHandler } from '../handlers/code-detection.handler';
import { NlpUtilsService } from 'src/common/services/nlp-utils.service';
import { AiUtilsService } from 'src/common/services/ai-utils.service';

export class V1SearchStrategy implements SearchStrategy {
  getEnabledFeatures(): Set<SearchFeature> {
    // V1: Original simple behavior - no stemming, no NLP
    return new Set([]);
  }

  buildPipeline(
    nlpUtils: NlpUtilsService,
    aiUtils: AiUtilsService,
  ): QueryEnhancementHandler {
    // V1: Only code detection, no other processing
    const codeDetection = new CodeDetectionHandler();

    return codeDetection;
  }
}
