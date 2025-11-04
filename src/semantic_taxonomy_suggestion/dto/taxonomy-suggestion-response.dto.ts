/**
 * Individual taxonomy suggestion result
 */
export interface TaxonomySuggestion {
  code: string;
  name: string;
  description?: string;
  score: number; // Combined score from intent classification + text matching
  match_type: 'intent' | 'text' | 'hybrid'; // How this taxonomy was matched
  resource_count?: number; // Number of resources with this taxonomy
}

/**
 * Response for taxonomy suggestion endpoint
 */
export interface TaxonomySuggestionResponse {
  took: number; // Time taken in milliseconds
  suggestions: TaxonomySuggestion[];
  metadata: {
    query: string;
    total_unique_taxonomies: number;
    search_strategy: string; // e.g., 'intent_classification', 'text_matching'
    embedding_used: boolean;
    classification?: {
      primary_intent: string | null;
      confidence: 'high' | 'medium' | 'low';
      is_low_information_query: boolean;
      taxonomy_codes_count: number;
    };
  };
}
