import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

/**
 * Shared service for interfacing with external AI services
 * - Embeddings: Ollama (OpenAI-compatible API)
 * - Classification & Reranking: ai-utils microservice
 *
 * This service is shared across multiple modules (hybrid_semantic, semantic_taxonomy_suggestion, etc.)
 */
@Injectable()
export class AiUtilsService {
  private readonly logger = new Logger(AiUtilsService.name);
  private readonly aiUtilsBaseUrl: string;
  private readonly ollamaBaseUrl: string;
  private readonly embeddingModel: string;

  constructor(private readonly configService: ConfigService) {
    this.aiUtilsBaseUrl = this.configService.get('AI_UTILS_URL');
    this.ollamaBaseUrl =
      this.configService.get('OLLAMA_BASE_URL') || 'http://localhost:11434';
    this.embeddingModel =
      this.configService.get('OLLAMA_EMBEDDING_MODEL') || 'bge-m3:567m';
  }

  /**
   * PHASE 1a: Embed the user's query using Ollama's OpenAI-compatible API
   * @param query - The user's search query
   * @returns The embedding vector for the query
   */
  async embedQuery(query: string): Promise<number[]> {
    this.logger.debug(
      `Embedding query: "${query}" using model: ${this.embeddingModel}`,
    );

    try {
      const response = await axios.post(
        `${this.ollamaBaseUrl}/v1/embeddings`,
        {
          model: this.embeddingModel,
          input: query,
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      // OpenAI-compatible response format:
      // { data: [{ embedding: number[], index: 0 }], model: string, usage: {...} }
      const embedding = response.data.data[0].embedding;

      this.logger.debug(
        `Successfully embedded query, dimension: ${embedding.length}`,
      );

      return embedding;
    } catch (error) {
      this.logger.error(`Failed to embed query via Ollama: ${error.message}`);
      throw error;
    }
  }

  /**
   * PHASE 1b: Classify the user's query intent using ai-utils microservice
   * @param query - The user's search query
   * @returns Classification result with intent, taxonomy codes, and confidence
   */
  async classifyQuery(query: string): Promise<IntentClassificationResult> {
    this.logger.debug(`Classifying query: "${query}"`);

    if (!this.aiUtilsBaseUrl) {
      this.logger.warn(
        'AI_UTILS_URL not configured - skipping intent classification',
      );
      return {
        primary_intent: null,
        top_intents: [],
        combined_taxonomy_codes: [],
        confidence: 'low',
        is_low_information_query: false,
        priority_rule_applied: false,
      };
    }

    try {
      const response = await axios.post(
        `${this.aiUtilsBaseUrl}/api/v1/intent-classification`,
        {
          query: query,
          request_id: null, // Optional: could generate UUID for tracking
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 5000, // 5 second timeout
        },
      );

      const classification: IntentClassificationResult = response.data;

      // Add the original query to query_characteristics if present
      if (classification.query_characteristics) {
        classification.query_characteristics.query = query;
      }

      this.logger.debug(
        `Intent classification: ${classification.primary_intent || 'low-info'} ` +
          `(confidence: ${classification.confidence}, ` +
          `is_low_info: ${classification.is_low_information_query}, ` +
          `taxonomy_codes: ${classification.combined_taxonomy_codes.length})`,
      );

      return classification;
    } catch (error) {
      this.logger.error(
        `Failed to classify query via ai-utils: ${error.message}`,
      );
      // Return a fallback classification instead of throwing
      // This allows search to continue even if classification fails
      return {
        primary_intent: null,
        top_intents: [],
        combined_taxonomy_codes: [],
        confidence: 'low',
        is_low_information_query: false,
        priority_rule_applied: false,
      };
    }
  }

  /**
   * FINAL PHASE: Rerank the top search results
   * @param query - The original user query
   * @param candidates - The candidate documents from OpenSearch
   * @param topK - Number of top results to return (default: 10)
   * @returns Reranked list of document IDs in optimal order
   */
  async rerankResults(
    query: string,
    candidates: Array<Record<string, any>>,
    topK: number = 10,
  ): Promise<Array<Record<string, any>>> {
    this.logger.debug(
      `Reranking ${candidates.length} candidates, returning top ${topK}`,
    );

    // TODO: Implement actual API call to ai-utils
    // Example endpoint: POST /api/rerank
    // Body: { query: string, documents: Array<{id, text}>, top_k: number }
    // Response: { ranked_results: Array<{id, score}> }

    try {
      // PSEUDOCODE STUB
      // const documentsForReranking = candidates.map(doc => ({
      //   id: doc._id,
      //   text: this.extractTextForReranking(doc._source),
      // }));
      //
      // const response = await axios.post(
      //   `${this.aiUtilsBaseUrl}/api/rerank`,
      //   {
      //     query,
      //     documents: documentsForReranking,
      //     top_k: topK,
      //   },
      //   {
      //     headers: {
      //       'Content-Type': 'application/json',
      //     },
      //   }
      // );
      //
      // // Map reranked IDs back to original documents
      // const rankedIds = response.data.ranked_results.map(r => r.id);
      // return this.reorderDocuments(candidates, rankedIds);

      this.logger.warn('rerankResults() is a stub - returning original order');
      return candidates.slice(0, topK);
    } catch (error) {
      this.logger.error(`Failed to rerank results: ${error.message}`);
      // Fallback: return original order
      return candidates.slice(0, topK);
    }
  }

  /**
   * Helper: Extract relevant text from document for reranking
   */
  private extractTextForReranking(source: Record<string, any>): string {
    // Combine relevant fields for reranking
    const parts: string[] = [];

    if (source.name) parts.push(source.name);
    if (source.description) parts.push(source.description);
    if (source.service?.name) parts.push(source.service.name);
    if (source.service?.description) parts.push(source.service.description);

    return parts.join(' ');
  }

  /**
   * Helper: Reorder documents based on ranked IDs
   */
  private reorderDocuments(
    documents: Array<Record<string, any>>,
    rankedIds: string[],
  ): Array<Record<string, any>> {
    const idToDoc = new Map(documents.map((doc) => [doc._id, doc]));
    return rankedIds.map((id) => idToDoc.get(id)).filter(Boolean);
  }
}

/**
 * Intent classification result interface
 * Matches the response from ai-utils microservice
 */
export interface IntentScore {
  intent: string;
  score: number;
}

export interface QueryCharacteristics {
  query?: string; // Added by Norse-API after receiving classification response
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
