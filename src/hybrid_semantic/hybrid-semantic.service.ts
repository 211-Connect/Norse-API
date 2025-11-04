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
import { OpenSearchService } from './services/opensearch.service';
import { Request } from 'express';

/**
 * Main service orchestrating the hybrid semantic search pipeline
 *
 * Pipeline phases:
 * 1. Query embedding and classification (parallel)
 * 2. Multi-strategy OpenSearch query execution
 * 3. Result reranking via ai-utils
 * 4. Post-processing and response preparation
 */
@Injectable()
export class HybridSemanticService {
  private readonly logger = new Logger(HybridSemanticService.name);

  constructor(
    private readonly aiUtilsService: AiUtilsService,
    private readonly openSearchService: OpenSearchService,
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
      // PHASE 2: Multi-Strategy OpenSearch Query
      // ============================================================
      const phase2Start = Date.now();

      const { results: rawResults, queryTimings } =
        await this.openSearchService.executeHybridSearch(
          queryEmbedding,
          searchRequest,
          headers,
          tenant.name,
          intentClassification,
        );

      const phase2Time = Date.now() - phase2Start;
      granularTimings.phase_2_opensearch = {
        total_parallel_time: phase2Time,
        individual_queries: queryTimings,
      };

      this.logger.debug(
        `Retrieved ${rawResults.length} candidates from OpenSearch`,
      );

      // ============================================================
      // PHASE 3: Reranking via ai-utils
      // ============================================================
      const phase3Start = Date.now();

      let rerankedResults = rawResults;

      if (searchRequest.q && rawResults.length > 0) {
        rerankedResults = await this.aiUtilsService.rerankResults(
          searchRequest.q,
          rawResults,
          searchRequest.limit,
        );
      } else {
        // No query or no results - just take top N
        rerankedResults = rawResults.slice(0, searchRequest.limit);
      }

      const phase3Time = Date.now() - phase3Start;
      granularTimings.phase_3_reranking = {
        total_time: phase3Time,
      };

      this.logger.debug(`Reranked to ${rerankedResults.length} final results`);

      // ============================================================
      // PHASE 4: Post-Processing & Response Preparation
      // ============================================================
      const phase4Start = Date.now();

      const processedHits = this.postProcessResults(
        rerankedResults,
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

      // Build sources_of_top_hits from processed results
      const sourcesOfTopHits: HitSource[] = processedHits.map((hit, index) => ({
        id: hit._id,
        organization_name: hit._source?.organization?.name,
        service_name: hit._source?.service?.name,
        rank: index + 1,
        sources: hit._sources || [],
        score: hit._score,
      }));

      const metadata: SearchMetadata = {
        search_pipeline: 'hybrid_semantic',
        intent_classification: intentClassification,
        is_low_information_query:
          intentClassification?.is_low_information_query || false,
        granular_phase_timings: granularTimings,
        sources_of_top_hits: sourcesOfTopHits,
      };

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
        metadata,
      };

      // Add search_after cursor for next page if there are results
      if (processedHits.length > 0) {
        const lastHit = processedHits[processedHits.length - 1];
        // Return sort values for cursor-based pagination
        if (lastHit?.sort) {
          response.search_after = lastHit.sort;
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
   * PHASE 4: Post-process results
   * - Remove embeddings from response
   * - Remove service area if requested
   * - Apply any additional transformations
   */
  private postProcessResults(
    hits: any[],
    searchRequest: SearchRequestDto,
  ): any[] {
    return hits.map((hit) => {
      const source = { ...hit._source };

      // Remove all embedding fields to reduce response size
      this.removeEmbeddings(source);

      // Remove service area if requested
      if (searchRequest.exclude_service_area && source.serviceArea) {
        delete source.serviceArea;
      }

      return {
        ...hit,
        _source: source,
      };
    });
  }

  /**
   * Recursively remove all embedding fields from the document
   */
  private removeEmbeddings(obj: any): void {
    if (!obj || typeof obj !== 'object') {
      return;
    }

    // Remove embedding field if present
    if ('embedding' in obj) {
      delete obj.embedding;
    }

    // Recursively process nested objects and arrays
    Object.values(obj).forEach((value) => {
      if (Array.isArray(value)) {
        value.forEach((item) => this.removeEmbeddings(item));
      } else if (typeof value === 'object' && value !== null) {
        this.removeEmbeddings(value);
      }
    });
  }
}
