import { IntentClassificationResult } from 'src/common/services/ai-utils.service';

/**
 * Response DTOs for hybrid semantic search
 */

/**
 * Granular phase timings showing parallel vs sequential execution
 *
 * Pipeline flow:
 * 1. Phase 1 (PARALLEL): Embedding + Classification run simultaneously
 *    - total_parallel_time: Wall clock time (max of the two)
 *    - embedding: Individual embedding time
 *    - classification: Individual classification time
 *
 * 2. Phase 2 (PARALLEL): Multiple OpenSearch queries via _msearch
 *    - total_parallel_time: Total _msearch execution time
 *    - individual_queries: Time each query took within OpenSearch
 *
 * 3. Phase 3 (SEQUENTIAL): Reranking
 *    - total_time: Time for reranking operation
 *
 * 4. Phase 4 (SEQUENTIAL): Post-processing
 *    - total_time: Time for post-processing
 */
export interface GranularPhaseTimings {
  phase_1_embedding_and_classification?: {
    total_parallel_time: number;
    embedding: number;
    classification: number;
  };
  phase_2_opensearch?: {
    total_parallel_time: number;
    individual_queries: {
      semantic_service?: number;
      semantic_taxonomy?: number;
      semantic_organization?: number;
      keyword?: number;
      intent_taxonomy?: number;
    };
  };
  phase_3_reranking?: {
    total_time: number;
  };
  phase_4_post_processing?: {
    total_time: number;
  };
}

export interface HitSource {
  id: string;
  organization_name?: string;
  service_name?: string;
  rank: number;
  sources: string[];
  score: number;
}

export interface SearchMetadata {
  search_pipeline: string;
  intent_classification?: IntentClassificationResult;
  is_low_information_query?: boolean;
  granular_phase_timings?: GranularPhaseTimings;
  sources_of_top_hits?: HitSource[];
}

export interface SearchResponseHits {
  total: {
    value: number;
    relation: string;
  };
  max_score: number | null;
  hits: Array<Record<string, any>>;
}

export interface SearchResponse {
  took: number;
  timed_out: boolean;
  hits: SearchResponseHits;
  search_after?: any[];
  metadata?: SearchMetadata;
}
