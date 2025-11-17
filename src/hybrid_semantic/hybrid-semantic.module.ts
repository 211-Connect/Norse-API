import { Module } from '@nestjs/common';
import { HybridSemanticController } from './hybrid-semantic.controller';
import { HybridSemanticService } from './hybrid-semantic.service';
import { AiUtilsService } from 'src/common/services/ai-utils.service';
import { OpenSearchService } from './services/opensearch.service';
import { WeightsConfigService } from './config/weights-config.service';
import { NlpUtilsService } from 'src/common/services/nlp-utils.service';

/**
 * Module for hybrid semantic search functionality
 *
 * Provides:
 * - Semantic search using embeddings
 * - Intent-driven taxonomy queries
 * - Keyword search with POS tagging and stemming
 * - AI-powered reranking
 * - Integration with ai-utils microservice
 * - Integration with OpenSearch cluster
 */
@Module({
  controllers: [HybridSemanticController],
  providers: [
    HybridSemanticService,
    AiUtilsService,
    OpenSearchService,
    WeightsConfigService,
    NlpUtilsService,
  ],
  exports: [HybridSemanticService, WeightsConfigService],
})
export class HybridSemanticModule {}
