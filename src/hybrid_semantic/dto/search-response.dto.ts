/**
 * Response DTOs for hybrid semantic search
 */

export interface IntentScore {
  intent: string;
  score: number;
}

export interface QueryCharacteristics {
  query_length: number;
  word_count: number;
  is_exact_match: boolean;
  is_meta_question: boolean;
  has_vague_pattern: boolean;
  generic_word_ratio: number;
  max_intent_score: number;
  score_entropy: number;
  has_domain_keywords: boolean;
}

export interface IntentClassificationResult {
  primary_intent: string | null;
  top_intents: IntentScore[];
  combined_taxonomy_codes: string[];
  confidence: 'high' | 'medium' | 'low';
  is_low_information_query: boolean;
  query_characteristics?: QueryCharacteristics;
  priority_rule_applied: boolean;
  all_intent_scores?: IntentScore[];
  setfit_scores?: Record<string, number>;
  request_id?: string | null;
}

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
