import { Module } from '@nestjs/common';
import { HybridSemanticController } from './hybrid-semantic.controller';
import { HybridSemanticService } from './hybrid-semantic.service';
import { HybridSemanticServiceRefactored } from './hybrid-semantic-refactored.service';
import { AiUtilsService } from 'src/common/services/ai-utils.service';
import { OpenSearchService } from './services/opensearch.service';
import { OpenSearchServiceRefactored } from './services/opensearch-refactored.service';
import { StrategyExecutorService } from './services/strategy-executor.service';
import { WeightsConfigService } from './config/weights-config.service';
import { NlpUtilsService } from 'src/common/services/nlp-utils.service';

// Infrastructure components
import { QueryBuilder } from './builders/query.builder';
import { FilterFactory } from './builders/filter.factory';
import { WeightResolver } from './resolvers/weight.resolver';
import { ResultProcessor } from './processors/result.processor';

// Search strategies
import { SemanticServiceStrategy } from './strategies/semantic/semantic-service.strategy';
import { SemanticTaxonomyStrategy } from './strategies/semantic/semantic-taxonomy.strategy';
import { SemanticOrganizationStrategy } from './strategies/semantic/semantic-organization.strategy';
import { KeywordOriginalStrategy } from './strategies/keyword/keyword-original.strategy';
import { KeywordNounsStrategy } from './strategies/keyword/keyword-nouns.strategy';
import { KeywordStemmedStrategy } from './strategies/keyword/keyword-stemmed.strategy';
import { KeywordSynonymsStrategy } from './strategies/keyword/keyword-synonyms.strategy';
import { KeywordTopicsStrategy } from './strategies/keyword/keyword-topics.strategy';
import { IntentTaxonomyStrategy } from './strategies/intent-taxonomy.strategy';
import { BrowseStrategy } from './strategies/browse.strategy';
import { MatchAllFilteredStrategy } from './strategies/match-all-filtered.strategy';

/**
 * All search strategy classes
 * Order matters - strategies are executed in this order
 */
const SEARCH_STRATEGIES = [
  // Browse and match-all strategies (execute first if applicable)
  BrowseStrategy,
  MatchAllFilteredStrategy,
  
  // Semantic strategies
  SemanticServiceStrategy,
  SemanticTaxonomyStrategy,
  SemanticOrganizationStrategy,
  
  // Keyword strategies
  KeywordOriginalStrategy,
  KeywordNounsStrategy,
  KeywordStemmedStrategy,
  KeywordSynonymsStrategy,
  KeywordTopicsStrategy,
  
  // Intent-driven strategy
  IntentTaxonomyStrategy,
];

/**
 * Module for hybrid semantic search functionality
 *
 * Refactored to use design patterns:
 * - Strategy Pattern: 11 search strategies for different query types
 * - Builder Pattern: QueryBuilder for fluent query construction
 * - Factory Pattern: FilterFactory for filter creation
 * - Separation of Concerns: Dedicated services for each responsibility
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
    // Original services (kept for backward compatibility during migration)
    HybridSemanticService,
    OpenSearchService,
    
    // Refactored services
    HybridSemanticServiceRefactored,
    OpenSearchServiceRefactored,
    StrategyExecutorService,
    
    // Infrastructure components
    QueryBuilder,
    FilterFactory,
    WeightResolver,
    ResultProcessor,
    
    // All search strategies
    ...SEARCH_STRATEGIES,
    
    // Strategy provider (injects all strategies into StrategyExecutorService)
    {
      provide: 'SEARCH_STRATEGIES',
      useFactory: (...strategies) => strategies,
      inject: SEARCH_STRATEGIES,
    },
    
    // Shared services
    AiUtilsService,
    WeightsConfigService,
    NlpUtilsService,
  ],
  exports: [
    HybridSemanticService,
    HybridSemanticServiceRefactored,
    WeightsConfigService,
  ],
})
export class HybridSemanticModule {}
