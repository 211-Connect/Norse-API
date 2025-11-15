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
      keyword_original?: number;
      keyword_nouns?: number;
      keyword_nouns_stemmed?: number;
      intent_taxonomy?: number;
      match_all_filtered?: number; // For taxonomy-only searches
    };
  };
  phase_3_reranking?: {
    total_time: number;
  };
  phase_4_post_processing?: {
    total_time: number;
  };
}

/**
 * Detailed source contribution for a search result
 * Tracks which strategy contributed and its scoring details
 */
export interface SourceContribution {
  strategy: string; // Name of the search strategy (e.g., 'semantic_service', 'keyword_original')
  pre_weight_score: number; // Score before strategy weight was applied
  strategy_weight: number; // Weight multiplier applied to this strategy
}

/**
 * Metadata for each top hit in search results
 * Provides full traceability of scoring and document information
 */
export interface HitSource {
  id: string;
  organization_name?: string;
  organization_description?: string;
  service_name?: string;
  service_description?: string;
  rank: number;
  total_document_relevance_score: number; // Final combined score
  sources: SourceContribution[]; // Detailed breakdown of strategy contributions
}

export interface SearchMetadata {
  search_pipeline: string;
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
  search_after?: any[]; // Cursor for next page (cursor-based pagination)
  total_results?: number; // Total number of matching results across all pages
  intent_classification?: IntentClassificationResult; // Always included for frontend features
  is_low_information_query?: boolean; // Always included for frontend features
  metadata?: SearchMetadata; // Only included when DEV_MODE=True
  // Legacy offset pagination metadata
  page?: number; // Current page number (1-indexed)
  total_pages?: number; // Total number of pages
  has_next_page?: boolean; // Whether there is a next page
  has_previous_page?: boolean; // Whether there is a previous page
}
