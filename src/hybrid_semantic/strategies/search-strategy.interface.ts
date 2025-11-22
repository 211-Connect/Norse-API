import { SearchRequestDto } from '../dto/search-request.dto';

/**
 * Context object containing all information needed for a search strategy to execute
 */
export interface SearchContext {
  /** Query embedding vector (if available) */
  embedding?: number[];
  
  /** Original search request with all parameters */
  searchRequest: SearchRequestDto;
  
  /** Pre-built filters to apply to the query */
  filters: any[];
  
  /** Number of candidates to retrieve per strategy */
  k: number;
  
  /** Cursor for pagination (cursor-based) */
  searchAfter?: any[];
  
  /** Whether to use offset-based pagination */
  useOffsetPagination?: boolean;
  
  /** Offset for pagination (offset-based) */
  offset?: number;
  
  /** Intent classification result (if available) */
  intentClassification?: any;
  
  /** Keyword variations generated from the query */
  keywordVariations?: KeywordVariations;
}

/**
 * Keyword variations generated from the original query
 */
export interface KeywordVariations {
  /** Original query with contractions expanded */
  original: string;
  
  /** Extracted nouns in original form */
  nouns: string[];
  
  /** Stemmed nouns */
  stemmedNouns: string[];
  
  /** Synonyms from WordNet */
  synonyms: string[];
  
  /** High-value entities (people, places, organizations) */
  topics: string[];
}

/**
 * Weight configuration for search strategies
 */
export interface WeightConfig {
  semantic: {
    service: number;
    taxonomy: number;
    organization: number;
  };
  strategies: {
    semantic_search: number;
    keyword_search: number;
    intent_driven: number;
  };
  geospatial: {
    weight: number;
    decay_scale: number;
    decay_offset: number;
  };
}

/**
 * Interface for all search strategies
 * Each strategy encapsulates the logic for building one type of OpenSearch query
 */
export interface SearchStrategy {
  /** Unique name identifying this strategy */
  readonly name: string;
  
  /**
   * Determine if this strategy should execute given the current context
   * @param context - Search context with all necessary information
   * @returns true if this strategy should execute
   */
  canExecute(context: SearchContext): boolean;
  
  /**
   * Build the OpenSearch query for this strategy
   * @param context - Search context with all necessary information
   * @returns OpenSearch query object
   */
  buildQuery(context: SearchContext): any;
  
  /**
   * Calculate the weight to apply to this strategy's results
   * @param weights - Resolved weight configuration
   * @returns Weight multiplier for this strategy
   */
  getWeight(weights: WeightConfig): number;
}
