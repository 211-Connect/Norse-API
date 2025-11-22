import { Injectable, Logger } from '@nestjs/common';
import { SearchRequestDto } from './dto/search-request.dto';
import {
  SearchResponse,
  SearchMetadata,
  GranularPhaseTimings,
  HitSource,
} from './dto/search-response.dto';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { AiUtilsService } from 'src/common/services/ai-utils.service';
import { OpenSearchServiceRefactored } from './services/opensearch-refactored.service';
import { ResultProcessor } from './processors/result.processor';
import { WeightResolver } from './resolvers/weight.resolver';
import { Request } from 'express';

/**
 * Refactored main service orchestrating the hybrid semantic search pipeline
 * Delegates to specialized services for each concern
 *
 * Pipeline phases:
 * 1. Query embedding and classification (parallel)
 * 2. Multi-strategy OpenSearch query execution (via strategies)
 * 3. Result reranking via ai-utils
 * 4. Post-processing and response preparation (via ResultProcessor)
 */
@Injectable()
export class HybridSemanticServiceRefactored {
  private readonly logger = new Logger(HybridSemanticServiceRefactored.name);

  constructor(
    private readonly aiUtilsService: AiUtilsService,
    private readonly openSearchService: OpenSearchServiceRefactored,
    private readonly resultProcessor: ResultProcessor,
    private readonly weightResolver: WeightResolver,
  ) {}

  /**
   * Execute the full hybrid semantic search pipeline
   */
  async search(
    searchRequest: SearchRequestDto,
    headers: HeadersDto,
    tenant: Request['tenant'],
  ): Promise<SearchResponse> {
    const startTime = Date.now();
    const granularTimings: GranularPhaseTimings = {};

    this.logger.log(
      `Starting hybrid semantic search for query: "${searchRequest.q}"`,
    );

    try {
      // ============================================================
      // PHASE 1: Query Embedding & Classification (Parallel)
      // ============================================================
      const phase1Start = Date.now();

      let queryEmbedding: number[] = [];
      let intentClassification: any = null;

      if (searchRequest.q && !searchRequest.disable_intent_classification) {
        // Execute embedding and classification in parallel with individual timing
        let embeddingTime = 0;
        let classificationTime = 0;

        const [embedding, classification] = await Promise.all([
          (async () => {
            const start = Date.now();
            const result = await this.aiUtilsService.embedQuery(
              searchRequest.q,
            );
            embeddingTime = Date.now() - start;
            return result;
          })(),
          (async () => {
            const start = Date.now();
            const result = await this.aiUtilsService.classifyQuery(
              searchRequest.q,
            );
            classificationTime = Date.now() - start;
            return result;
          })(),
        ]);

        queryEmbedding = embedding;
        intentClassification = classification;

        const phase1Time = Date.now() - phase1Start;
        granularTimings.phase_1_embedding_and_classification = {
          total_parallel_time: phase1Time,
          embedding: embeddingTime,
          classification: classificationTime,
        };

        this.logger.debug(
          `Intent classification: ${classification.primary_intent || 'low-info'} (confidence: ${classification.confidence})`,
        );
      } else if (searchRequest.q) {
        // Only embedding needed for keyword search
        const embeddingStart = Date.now();
        queryEmbedding = await this.aiUtilsService.embedQuery(searchRequest.q);
        const embeddingTime = Date.now() - embeddingStart;
        const phase1Time = Date.now() - phase1Start;

        granularTimings.phase_1_embedding_and_classification = {
          total_parallel_time: phase1Time,
          embedding: embeddingTime,
          classification: 0,
        };
      }

      // ============================================================
      // PHASE 2: OpenSearch Interaction (Strategy-Based Execution)
      // ============================================================
      const {
        responses: opensearchResponses,
        strategyNames,
        timings: phase2Timings,
      } = await this.openSearchService.executeHybridSearch(
        queryEmbedding,
        searchRequest,
        headers,
        tenant.name,
        intentClassification,
      );

      granularTimings.phase_2_opensearch = phase2Timings;

      this.logger.debug(
        `Phase 2 complete: received ${opensearchResponses.length} strategy responses`,
      );

      // ============================================================
      // PHASE 3: Reranking & Post-Processing (ResultProcessor)
      // ============================================================
      const phase3Start = Date.now();

      // 3a. Combine and deduplicate results from all strategies
      const combineStart = Date.now();
      const { results: combinedResults, totalResults } =
        this.resultProcessor.combineAndDeduplicate(
          opensearchResponses,
          strategyNames,
        );
      const combineTime = Date.now() - combineStart;

      this.logger.debug(
        `Combined ${combinedResults.length} unique results from ${totalResults} total matches`,
      );

      // 3b. AI Reranking or simple top-N selection
      const rerankStart = Date.now();
      let rerankedResults = combinedResults;

      if (searchRequest.q && combinedResults.length > 0) {
        rerankedResults = await this.aiUtilsService.rerankResults(
          searchRequest.q,
          combinedResults,
          searchRequest.limit,
        );
      } else {
        // No query or no results - just take top N
        rerankedResults = combinedResults.slice(0, searchRequest.limit);
      }
      const rerankTime = Date.now() - rerankStart;

      this.logger.debug(`Reranked to ${rerankedResults.length} final results`);

      // 3c. Sorting and pagination (currently minimal, but tracked for future)
      const sortStart = Date.now();
      const sortedResults = rerankedResults;
      const sortTime = Date.now() - sortStart;

      // 3d. Add distance information
      const distanceStart = Date.now();
      const resultsWithDistance = this.resultProcessor.addDistanceInfo(
        sortedResults,
        searchRequest,
      );
      const distanceTime = Date.now() - distanceStart;

      // 3e. Add relevant text snippets
      const snippetStart = Date.now();
      const finalResults = this.resultProcessor.addRelevantTextSnippets(
        resultsWithDistance,
        searchRequest.q,
      );
      const snippetTime = Date.now() - snippetStart;

      const phase3Time = Date.now() - phase3Start;
      granularTimings.phase_3_reranking_and_processing = {
        total_time: phase3Time,
        ai_reranking: rerankTime,
        combine_and_dedupe: combineTime,
        sorting_and_pagination: sortTime,
        distance_calculation: distanceTime,
        snippet_extraction: snippetTime,
      };

      this.logger.debug(
        `Phase 3 complete: combine=${combineTime}ms, rerank=${rerankTime}ms, distance=${distanceTime}ms, snippets=${snippetTime}ms`,
      );

      // ============================================================
      // PHASE 4: Final Response Preparation
      // ============================================================
      const phase4Start = Date.now();

      const processedHits = this.resultProcessor.postProcess(
        finalResults,
        searchRequest,
      );

      const phase4Time = Date.now() - phase4Start;
      granularTimings.phase_4_post_processing = {
        total_time: phase4Time,
      };

      // ============================================================
      // Build Final Response
      // ============================================================
      const totalTime = Date.now() - startTime;

      // Build sources_of_top_hits from processed results with detailed source contributions
      const sourcesOfTopHits: HitSource[] = processedHits.map((hit, index) => {
        // Calculate detailed source contributions with accurate pre-weight scores
        const sourceContributions = this.buildSourceContributions(
          hit._source_contributions || [],
          searchRequest,
        );

        return {
          id: hit._id,
          organization_name: hit._source?.organization?.name,
          organization_description: hit._source?.organization?.description,
          service_name: hit._source?.service?.name,
          service_description: hit._source?.service?.description,
          rank: index + 1,
          total_document_relevance_score: hit._score,
          sources: sourceContributions,
        };
      });

      // Check DEV_MODE environment variable
      const isDevMode = process.env.DEV_MODE === 'True';

      const response: SearchResponse = {
        took: totalTime,
        timed_out: false,
        hits: {
          total: {
            value: processedHits.length,
            relation: 'eq',
          },
          max_score: processedHits[0]?._score || null,
          hits: processedHits,
        },
        total_results: totalResults,
        intent_classification: intentClassification,
        is_low_information_query:
          intentClassification?.is_low_information_query || false,
      };

      // Only include metadata when DEV_MODE=True
      if (isDevMode) {
        const metadata: SearchMetadata = {
          search_pipeline: 'hybrid_semantic',
          granular_phase_timings: granularTimings,
          sources_of_top_hits: sourcesOfTopHits,
        };
        response.metadata = metadata;
      }

      // Add pagination metadata based on mode
      if (searchRequest.legacy_offset_pagination) {
        // Legacy offset pagination metadata
        const totalPages = Math.ceil(totalResults / searchRequest.limit);
        response.page = searchRequest.page;
        response.total_pages = totalPages;
        response.has_next_page = searchRequest.page < totalPages;
        response.has_previous_page = searchRequest.page > 1;
      } else {
        // Cursor-based pagination: Add search_after cursor for next page if there are results
        if (processedHits.length > 0) {
          const lastHit = processedHits[processedHits.length - 1];
          // Return sort values for cursor-based pagination
          if (lastHit?.sort) {
            response.search_after = lastHit.sort;
          }
        }
      }

      this.logger.log(
        `Hybrid semantic search completed in ${totalTime}ms, returned ${processedHits.length} results`,
      );

      return response;
    } catch (error) {
      this.logger.error(
        `Hybrid semantic search failed: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Build detailed source contributions with normalized scores
   * Uses the pre-normalized scores from ResultProcessor (0-1 scale)
   */
  private buildSourceContributions(
    rawContributions: any[],
    searchRequest: SearchRequestDto,
  ): any[] {
    return rawContributions.map((contribution) => {
      // Get the actual weight that was applied to this strategy
      const actualWeight = this.getStrategyWeight(
        contribution.strategy,
        searchRequest,
      );

      // Use the normalized score (0-1 scale) as the pre-weight score
      const preWeightScore = contribution.pre_weight_score || 0;

      return {
        strategy: contribution.strategy,
        pre_weight_score: Math.round(preWeightScore * 10000) / 10000,
        strategy_weight: actualWeight,
      };
    });
  }

  /**
   * Get the actual weight applied to a specific strategy
   * Matches the weight calculation logic in strategies
   */
  private getStrategyWeight(
    strategyName: string,
    searchRequest: SearchRequestDto,
  ): number {
    const weights = this.weightResolver.resolve(searchRequest);

    // Semantic strategies
    if (strategyName === 'semantic_service') {
      return weights.semantic.service * weights.strategies.semantic_search;
    }
    if (strategyName === 'semantic_taxonomy') {
      return weights.semantic.taxonomy * weights.strategies.semantic_search;
    }
    if (strategyName === 'semantic_organization') {
      return weights.semantic.organization * weights.strategies.semantic_search;
    }

    // Keyword strategies with variation-specific weights
    if (strategyName === 'keyword_original') {
      return weights.strategies.keyword_search;
    }
    if (strategyName === 'keyword_nouns') {
      return weights.strategies.keyword_search * 0.95;
    }
    if (strategyName === 'keyword_nouns_stemmed') {
      return weights.strategies.keyword_search * 0.85;
    }
    if (strategyName === 'keyword_synonyms') {
      return weights.strategies.keyword_search * 0.85;
    }
    if (strategyName === 'keyword_topics') {
      return weights.strategies.keyword_search * 0.95 * 1.1;
    }

    // Intent-driven taxonomy
    if (strategyName === 'intent_taxonomy') {
      return weights.strategies.intent_driven;
    }

    // Default
    return 1.0;
  }
}
