import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SemanticTaxonomySuggestionController } from './semantic_taxonomy_suggestion.controller';
import { SemanticTaxonomySuggestionService } from './semantic_taxonomy_suggestion.service';
import { AiUtilsService } from 'src/common/services/ai-utils.service';

/**
 * Module for semantic taxonomy suggestions
 *
 * This module provides real-time taxonomy suggestions by combining:
 * - Semantic search (via embeddings from Ollama)
 * - Traditional text matching (via OpenSearch)
 *
 * Dependencies:
 * - ConfigModule: For environment configuration (OpenSearch URL, Ollama URL)
 * - AiUtilsService: For query embedding via Ollama
 */
@Module({
  imports: [ConfigModule],
  controllers: [SemanticTaxonomySuggestionController],
  providers: [SemanticTaxonomySuggestionService, AiUtilsService],
  exports: [SemanticTaxonomySuggestionService],
})
export class SemanticTaxonomySuggestionModule {}
