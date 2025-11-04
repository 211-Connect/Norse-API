import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@opensearch-project/opensearch';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { AiUtilsService } from 'src/common/services/ai-utils.service';
import { getTenantShortCode } from 'src/common/config/tenant-mapping.config';
import { TaxonomySuggestionQueryDto } from './dto/taxonomy-suggestion-query.dto';
import {
  TaxonomySuggestion,
  TaxonomySuggestionResponse,
} from './dto/taxonomy-suggestion-response.dto';
import { Request } from 'express';
import * as nlp from 'wink-nlp-utils';

/**
 * Service for providing semantic taxonomy suggestions
 * Uses query classification to predict relevant taxonomies based on intent
 */
@Injectable()
export class SemanticTaxonomySuggestionService {
  private readonly logger = new Logger(SemanticTaxonomySuggestionService.name);
  private readonly client: Client;

  constructor(
    private readonly configService: ConfigService,
    private readonly aiUtilsService: AiUtilsService,
  ) {
    const node =
      this.configService.get<string>('OPENSEARCH_NODE') ||
      'http://localhost:9200';
    this.client = new Client({
      node,
      ssl: {
        rejectUnauthorized: false,
      },
    });
    this.logger.log(`OpenSearch client initialized for taxonomy suggestions`);
  }

  /**
   * Main method: Get taxonomy suggestions based on user query
   */
  async getTaxonomySuggestions(
    query: TaxonomySuggestionQueryDto,
    headers: HeadersDto,
    tenant: Request['tenant'],
  ): Promise<TaxonomySuggestionResponse> {
    const startTime = Date.now();

    this.logger.log(`Getting taxonomy suggestions for query: "${query.query}"`);

    try {
      // Step 1: Classify the query to get predicted taxonomy codes
      const classification = await this.aiUtilsService.classifyQuery(
        query.query,
      );

      this.logger.debug(
        `Intent classification: ${classification.primary_intent || 'low-info'} ` +
          `(confidence: ${classification.confidence}, ` +
          `taxonomy_codes: ${classification.combined_taxonomy_codes.length})`,
      );

      // Step 2: If we have taxonomy codes, search for resources with those taxonomies
      // Otherwise, fall back to text matching
      const tenantShortCode = getTenantShortCode(tenant.name);
      const indexName = `${tenantShortCode}-resources_${query.lang}`;

      const rawResults = await this.executeTaxonomySearch(
        indexName,
        query,
        classification,
      );

      // Step 3: Aggregate and rank taxonomies
      const suggestions = this.aggregateTaxonomies(
        rawResults,
        query.limit,
        classification,
        query.query,
      );

      // Step 4: Build response
      const took = Date.now() - startTime;
      const response: TaxonomySuggestionResponse = {
        took,
        suggestions,
        metadata: {
          query: query.query,
          total_unique_taxonomies: suggestions.length,
          search_strategy:
            classification.combined_taxonomy_codes.length > 0
              ? 'intent_classification'
              : 'text_matching',
          embedding_used: false,
          classification: {
            primary_intent: classification.primary_intent,
            confidence: classification.confidence,
            is_low_information_query: classification.is_low_information_query,
            taxonomy_codes_count: classification.combined_taxonomy_codes.length,
          },
        },
      };

      this.logger.log(
        `Taxonomy suggestions completed in ${took}ms, returned ${suggestions.length} suggestions`,
      );

      return response;
    } catch (error) {
      this.logger.error(
        `Failed to get taxonomy suggestions: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Execute taxonomy search using classification results and text matching
   * Uses OpenSearch multi-search to run both strategies in parallel
   */
  private async executeTaxonomySearch(
    indexName: string,
    query: TaxonomySuggestionQueryDto,
    classification: any,
  ): Promise<any[]> {
    const candidatesPerStrategy = Math.max(query.limit * 5, 50); // Get more candidates to aggregate

    const msearchBody = [];

    // Strategy 1: Intent-driven taxonomy search (if we have taxonomy codes)
    if (
      classification.combined_taxonomy_codes &&
      classification.combined_taxonomy_codes.length > 0 &&
      !classification.is_low_information_query
    ) {
      this.logger.debug(
        `Adding intent-driven taxonomy search with ${classification.combined_taxonomy_codes.length} codes`,
      );
      msearchBody.push({ index: indexName });
      msearchBody.push(
        this.buildIntentTaxonomyQuery(
          classification.combined_taxonomy_codes,
          candidatesPerStrategy,
          query.code,
        ),
      );
    }

    // Strategy 2: Text matching on taxonomy code and name (always include as fallback)
    msearchBody.push({ index: indexName });
    msearchBody.push(
      this.buildTextTaxonomyQuery(
        query.query,
        candidatesPerStrategy,
        query.code,
      ),
    );

    try {
      const response = await this.client.msearch({
        body: msearchBody,
      });

      // Combine results from both strategies
      const combinedResults = this.combineSearchResults(
        response.body.responses,
      );

      this.logger.debug(
        `Taxonomy search returned ${combinedResults.length} resources`,
      );

      return combinedResults;
    } catch (error) {
      this.logger.error(
        `OpenSearch taxonomy query failed: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Build intent-driven taxonomy query
   * Searches for resources matching any of the provided taxonomy codes
   */
  private buildIntentTaxonomyQuery(
    taxonomyCodes: string[],
    k: number,
    codePrefix?: string,
  ): any {
    const query: any = {
      size: k,
      _source: ['taxonomies'],
      query: {
        nested: {
          path: 'taxonomies',
          query: {
            bool: {
              must: [
                {
                  terms: {
                    'taxonomies.code': taxonomyCodes,
                  },
                },
              ],
            },
          },
          score_mode: 'max',
          inner_hits: {
            name: 'matched_taxonomies',
            size: 10, // Return up to 10 matched taxonomies per resource
            _source: ['code', 'name', 'description'],
          },
        },
      },
    };

    // Add code prefix filter if provided
    if (codePrefix) {
      query.query.nested.query.bool.must.push({
        prefix: {
          'taxonomies.code': {
            value: codePrefix.toUpperCase(),
            case_insensitive: true,
          },
        },
      });
    }

    return query;
  }

  /**
   * Build text matching query on taxonomy code and name
   * Uses multi_match with bool_prefix for autocomplete-style matching
   */
  private buildTextTaxonomyQuery(
    searchQuery: string,
    k: number,
    codePrefix?: string,
  ): any {
    // Check if query looks like a taxonomy code (e.g., "BD-1800" or "BD")
    const isCodePattern = /^[a-zA-Z]{1,2}(-\d{1,4}(\.\d{1,4}){0,3})?$/i.test(
      searchQuery,
    );

    const query: any = {
      size: k,
      _source: ['taxonomies'],
      query: {
        nested: {
          path: 'taxonomies',
          query: {
            bool: {
              should: [],
              minimum_should_match: 1,
            },
          },
          score_mode: 'max',
          inner_hits: {
            name: 'matched_taxonomies',
            size: 10,
            _source: ['code', 'name', 'description'],
          },
        },
      },
    };

    // Add multi_match for name (always)
    query.query.nested.query.bool.should.push({
      multi_match: {
        query: searchQuery,
        type: 'bool_prefix',
        fields: [
          'taxonomies.name^2',
          'taxonomies.name._2gram',
          'taxonomies.name._3gram',
        ],
      },
    });

    // Add code matching with higher boost if query looks like a code
    if (isCodePattern) {
      query.query.nested.query.bool.should.push({
        multi_match: {
          query: searchQuery.toUpperCase(),
          type: 'bool_prefix',
          fields: [
            'taxonomies.code^3',
            'taxonomies.code._2gram^2',
            'taxonomies.code._3gram',
          ],
          boost: 2.0,
        },
      });
    } else {
      // Regular code search with lower boost
      query.query.nested.query.bool.should.push({
        multi_match: {
          query: searchQuery,
          type: 'bool_prefix',
          fields: [
            'taxonomies.code',
            'taxonomies.code._2gram',
            'taxonomies.code._3gram',
          ],
        },
      });
    }

    // Add code prefix filter if provided
    if (codePrefix) {
      query.query.nested.query.bool.filter = [
        {
          prefix: {
            'taxonomies.code': {
              value: codePrefix.toUpperCase(),
              case_insensitive: true,
            },
          },
        },
      ];
    }

    return query;
  }

  /**
   * Combine results from multiple search strategies
   */
  private combineSearchResults(responses: any[]): any[] {
    const seenIds = new Set<string>();
    const allResults: any[] = [];

    responses.forEach((response) => {
      if (response.hits && response.hits.hits) {
        response.hits.hits.forEach((hit: any) => {
          if (!seenIds.has(hit._id)) {
            seenIds.add(hit._id);
            allResults.push(hit);
          }
        });
      }
    });

    return allResults;
  }

  /**
   * Aggregate taxonomies across all resources and rank them
   * Returns unique taxonomies with combined scores
   */
  private aggregateTaxonomies(
    results: any[],
    limit: number,
    classification: any,
    queryText: string,
  ): TaxonomySuggestion[] {
    // Map to store unique taxonomies by code
    const taxonomyMap = new Map<
      string,
      {
        code: string;
        name: string;
        description?: string;
        scores: number[];
        resourceCount: number;
        hasIntentMatch: boolean;
        hasTextMatch: boolean;
        isFromClassification: boolean;
        textMatchScores: number[]; // Track text match scores for averaging
      }
    >();

    // Track which taxonomies came from classification
    const classificationCodes = new Set(
      classification.combined_taxonomy_codes || [],
    );

    // Process each resource and extract matched taxonomies
    results.forEach((hit) => {
      const score = hit._score;

      // Extract taxonomies from inner_hits (these are the ones that matched)
      const innerHits = hit.inner_hits?.matched_taxonomies?.hits?.hits || [];

      this.logger.debug(
        `Processing resource ${hit._id}: score=${score}, innerHits=${innerHits.length}, ` +
          `has_source_taxonomies=${!!hit._source?.taxonomies}, ` +
          `source_taxonomies_count=${hit._source?.taxonomies?.length || 0}`,
      );

      // Since inner_hits._source returns empty objects in OpenSearch nested queries,
      // we need to filter taxonomies based on the search strategy:
      // 1. For intent-driven matches: only include taxonomies from classification
      // 2. For text matches: include taxonomies that match the query text

      if (hit._source?.taxonomies) {
        hit._source.taxonomies.forEach((taxonomy: any) => {
          if (!taxonomy.code) return;

          const isFromClassification = classificationCodes.has(taxonomy.code);

          // Determine if this taxonomy should be included based on match type
          let shouldInclude = false;

          // Blended approach: Include if from classification OR text matching
          const textMatchScore = this.computeTextMatchScore(
            queryText,
            taxonomy.name,
            taxonomy.code,
          );

          shouldInclude = isFromClassification || textMatchScore > 0;

          if (shouldInclude) {
            this.addOrUpdateTaxonomy(
              taxonomyMap,
              taxonomy,
              score,
              hit._score,
              isFromClassification,
              textMatchScore,
            );
          }
        });
      }
    });

    // Convert map to array and calculate final scores using blended approach
    const suggestions = Array.from(taxonomyMap.values()).map((data) => {
      // Signal 1: Classification confidence (40% weight)
      const classificationScore = data.isFromClassification
        ? this.getClassificationConfidenceScore(classification.confidence)
        : 0;

      // Signal 2: Text matching score (30% weight)
      const avgTextMatchScore =
        data.textMatchScores.length > 0
          ? data.textMatchScores.reduce((a, b) => a + b, 0) /
            data.textMatchScores.length
          : 0;

      // Signal 3: OpenSearch relevance (20% weight)
      const avgOpenSearchScore =
        data.scores.reduce((a, b) => a + b, 0) / data.scores.length;
      const normalizedOpenSearchScore = Math.min(avgOpenSearchScore / 10, 1); // Normalize to 0-1

      // Signal 4: Popularity boost (10% weight)
      const popularityScore = Math.min(
        Math.log(data.resourceCount + 1) / Math.log(100),
        1,
      ); // Normalize to 0-1

      // Blended final score
      const finalScore =
        classificationScore * 0.4 +
        avgTextMatchScore * 0.3 +
        normalizedOpenSearchScore * 0.2 +
        popularityScore * 0.1;

      // Determine match type
      let matchType: 'intent' | 'text' | 'hybrid' = 'hybrid';
      if (data.hasIntentMatch && !data.hasTextMatch) {
        matchType = 'intent';
      } else if (data.hasTextMatch && !data.hasIntentMatch) {
        matchType = 'text';
      }

      return {
        code: data.code,
        name: data.name,
        description: data.description,
        score: finalScore,
        match_type: matchType,
        resource_count: data.resourceCount,
      };
    });

    // Sort by score (descending) and take top N
    suggestions.sort((a, b) => b.score - a.score);

    return suggestions.slice(0, limit);
  }

  /**
   * Convert classification confidence to a numeric score
   */
  private getClassificationConfidenceScore(
    confidence: 'high' | 'medium' | 'low',
  ): number {
    switch (confidence) {
      case 'high':
        return 1.0;
      case 'medium':
        return 0.7;
      case 'low':
        return 0.4;
      default:
        return 0;
    }
  }

  /**
   * Compute text match score using NLP tokenization and n-grams
   * Uses wink-nlp-utils for better text matching
   * Returns a score from 0 to 1
   */
  private computeTextMatchScore(
    queryText: string,
    taxonomyName?: string,
    taxonomyCode?: string,
  ): number {
    if (!queryText || (!taxonomyName && !taxonomyCode)) {
      return 0;
    }

    // Tokenize and clean the query
    const queryTokens = nlp.string.tokenize(queryText.toLowerCase());
    const queryWords = nlp.tokens.removeWords(queryTokens); // Remove stop words
    const queryStem = queryWords.map((token) => nlp.string.stem(token));

    // Prepare taxonomy text for matching
    const taxonomyText = [taxonomyName, taxonomyCode]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const taxonomyTokens = nlp.string.tokenize(taxonomyText);
    const taxonomyWords = nlp.tokens.removeWords(taxonomyTokens);
    const taxonomyStem = taxonomyWords.map((token) => nlp.string.stem(token));

    let score = 0;

    // Strategy 1: Exact token matches (after stemming) - highest weight
    const exactMatches = queryStem.filter((qStem) =>
      taxonomyStem.includes(qStem),
    );
    if (exactMatches.length > 0) {
      score += 0.5 * (exactMatches.length / queryStem.length);
    }

    // Strategy 2: Bigram matches - medium weight
    const queryBigrams = nlp.tokens.bigrams(queryWords);
    const taxonomyBigrams = nlp.tokens.bigrams(taxonomyWords);

    const bigramMatches = queryBigrams.filter((qBigram) =>
      taxonomyBigrams.some(
        (tBigram) => qBigram[0] === tBigram[0] && qBigram[1] === tBigram[1],
      ),
    );
    if (bigramMatches.length > 0 && queryBigrams.length > 0) {
      score += 0.3 * (bigramMatches.length / queryBigrams.length);
    }

    // Strategy 3: Substring matches (for compound words) - lower weight
    const substringMatches = queryStem.filter((qStem) =>
      taxonomyText.includes(qStem),
    );
    if (substringMatches.length > 0) {
      score += 0.2 * (substringMatches.length / queryStem.length);
    }

    return Math.min(score, 1.0); // Cap at 1.0
  }

  /**
   * Helper: Add or update taxonomy in the aggregation map
   */
  private addOrUpdateTaxonomy(
    taxonomyMap: Map<string, any>,
    taxonomy: any,
    score: number,
    resourceScore: number,
    isFromClassification: boolean,
    textMatchScore: number,
  ): void {
    const existing = taxonomyMap.get(taxonomy.code);

    if (existing) {
      // Update existing entry
      existing.scores.push(score);
      existing.resourceCount++;
      existing.textMatchScores.push(textMatchScore);

      // Update match type tracking
      if (isFromClassification) {
        existing.hasIntentMatch = true;
        existing.isFromClassification = true;
      }
      if (textMatchScore > 0) {
        existing.hasTextMatch = true;
      }
    } else {
      // Add new entry
      taxonomyMap.set(taxonomy.code, {
        code: taxonomy.code,
        name: taxonomy.name,
        description: taxonomy.description,
        scores: [score],
        resourceCount: 1,
        hasIntentMatch: isFromClassification,
        hasTextMatch: textMatchScore > 0,
        isFromClassification: isFromClassification,
        textMatchScores: [textMatchScore],
      });
    }
  }

  /**
   * Health check for the service
   */
  async checkHealth(): Promise<any> {
    try {
      const health = await this.client.cluster.health();
      return {
        status: 'connected',
        cluster: health.body,
      };
    } catch (error) {
      this.logger.error(`OpenSearch health check failed: ${error.message}`);
      return {
        status: 'disconnected',
        error: error.message,
      };
    }
  }
}
