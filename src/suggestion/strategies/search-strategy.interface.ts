import { NlpUtilsService } from 'src/common/services/nlp-utils.service';
import { AiUtilsService } from 'src/common/services/ai-utils.service';
import { QueryEnhancementHandler } from '../handlers/query-enhancement-handler.base';
import { SearchFeature } from '../types/search-context.interface';

export interface SearchStrategy {
  getEnabledFeatures(): Set<SearchFeature>;
  buildPipeline(
    nlpUtils: NlpUtilsService,
    aiUtils: AiUtilsService,
  ): QueryEnhancementHandler;
}
