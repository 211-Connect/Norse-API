import {
  IntentClassificationResult,
  IntentScore,
  QueryCharacteristics,
} from 'src/common/services/ai-utils.service';

/**
 * Response DTOs for hybrid semantic search
 */

export interface SearchMetadata {
  search_pipeline: string;
  intent_classification?: IntentClassificationResult;
  is_low_information_query?: boolean;
  phase_timings?: Record<string, number>;
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
