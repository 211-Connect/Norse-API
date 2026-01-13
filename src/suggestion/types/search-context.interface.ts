import { HeadersDto } from 'src/common/dto/headers.dto';

export enum SearchFeature {
  STEMMING = 'stemming',
  SYNONYMS = 'synonyms',
  INTENT_CLASSIFICATION = 'intent_classification',
  GENERIC_NOUN_FILTERING = 'generic_noun_filtering',
  FUZZY_MATCHING = 'fuzzy_matching',
}

export interface ProcessedQuery {
  query: string;
  type: 'user' | 'intent' | 'synonym';
  source?: string; // What generated this query
  weight?: number; // For result ranking
}

export interface SearchContext {
  // Input
  originalQuery: string;
  headers: HeadersDto;
  version: '1' | '2';
  skip: number;
  disableIntentClassification?: boolean;

  // Derived state (populated by handlers)
  isCodeSearch: boolean;
  fields: string[];
  processedQueries: ProcessedQuery[];
  intentClassification?: any;

  // Configuration
  features: Set<SearchFeature>;
}
