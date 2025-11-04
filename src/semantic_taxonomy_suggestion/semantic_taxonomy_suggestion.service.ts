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

          if (isFromClassification) {
            // Always include taxonomies from classification
            shouldInclude = true;
          } else {
            // For text matches, check if taxonomy name/code contains the query
            const queryLower = queryText.toLowerCase();
            const nameMatch = taxonomy.name?.toLowerCase().includes(queryLower);
            const codeMatch = taxonomy.code?.toLowerCase().includes(queryLower);
            shouldInclude = nameMatch || codeMatch;
          }

          if (shouldInclude) {
            this.addOrUpdateTaxonomy(
              taxonomyMap,
              taxonomy,
              score,
              hit._score,
              isFromClassification,
            );
          }
        });
      }
    });

    // Convert map to array and calculate final scores
    const suggestions = Array.from(taxonomyMap.values()).map((data) => {
      // Calculate average score across all occurrences
      const avgScore =
        data.scores.reduce((a, b) => a + b, 0) / data.scores.length;

      // Boost score based on resource count (more resources = more relevant)
      const resourceCountBoost = Math.log(data.resourceCount + 1) * 0.1;

      // Extra boost for taxonomies that came from classification
      const classificationBoost = data.isFromClassification ? 0.5 : 0;

      const finalScore = avgScore + resourceCountBoost + classificationBoost;

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
   * Helper: Add or update taxonomy in the aggregation map
   */
  private addOrUpdateTaxonomy(
    taxonomyMap: Map<string, any>,
    taxonomy: any,
    score: number,
    resourceScore: number,
    isFromClassification: boolean,
  ): void {
    const existing = taxonomyMap.get(taxonomy.code);

    if (existing) {
      // Update existing entry
      existing.scores.push(score);
      existing.resourceCount++;

      // Update match type tracking
      if (isFromClassification) {
        existing.hasIntentMatch = true;
        existing.isFromClassification = true;
      } else {
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
        hasTextMatch: !isFromClassification,
        isFromClassification: isFromClassification,
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
