import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@opensearch-project/opensearch';
import { SearchRequestDto } from '../dto/search-request.dto';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { getTenantShortCode } from 'src/common/config/tenant-mapping.config';
import { WeightsConfigService } from '../config/weights-config.service';
import * as nlp from 'wink-nlp-utils';
import winkNLP from 'wink-nlp';
import model from 'wink-eng-lite-web-model';

/**
 * Service for building and executing OpenSearch queries
 * Handles multi-search (_msearch) for hybrid semantic search
 */
@Injectable()
export class OpenSearchService {
  private readonly logger = new Logger(OpenSearchService.name);
  private readonly client: Client;
  private readonly nlpEngine: any;
  private readonly its: any;

  constructor(
    private readonly configService: ConfigService,
    private readonly weightsConfigService: WeightsConfigService,
  ) {
    const node =
      this.configService.get<string>('OPENSEARCH_NODE') ||
      'http://localhost:9200';
    const username = this.configService.get<string>('OPENSEARCH_USERNAME');
    const password = this.configService.get<string>('OPENSEARCH_PASSWORD');
    const nodeEnv = this.configService.get<string>('NODE_ENV') || 'development';

    // Configure SSL based on environment
    const sslConfig =
      nodeEnv === 'production'
        ? {
            requestCert: true,
            rejectUnauthorized: true,
          }
        : {
            rejectUnauthorized: false,
          };

    this.client = new Client({
      node,
      ssl: sslConfig,
      ...(username && password
        ? {
            auth: {
              username,
              password,
            },
          }
        : {}),
    });
    this.logger.log(
      `OpenSearch client initialized with node: ${node} (env: ${nodeEnv})`,
    );

    // Initialize wink-nlp for POS tagging
    this.nlpEngine = winkNLP(model);
    this.its = this.nlpEngine.its;
    this.logger.log('wink-nlp initialized for POS tagging');
  }

  /**
   * Get the OpenSearch index name based on tenant and locale
   * Format: {tenant-short-code}-resources_{locale}
   * @param tenant - Tenant short code (e.g., 'il211')
   * @param locale - Language locale (e.g., 'en', 'es')
   * @returns Index name in format: {tenant}-resources_{locale}
   */
  getIndexName(tenant: string, locale: string): string {
    return `${tenant}-resources_${locale}`;
  }

  /**
   * PHASE 2: Execute hybrid semantic search using _msearch
   * Combines multiple search strategies:
   * 1. Service-level semantic search (service.embedding)
   * 2. Taxonomy-level semantic search (taxonomies[].embedding)
   * 3. Organization-level semantic search (organization.embedding)
   * 4. Keyword search (optional)
   * 5. Intent-driven taxonomy search (based on classification)
   */
  async executeHybridSearch(
    queryEmbedding: number[],
    searchRequest: SearchRequestDto,
    headers: HeadersDto,
    tenant: string,
    intentClassification?: any,
  ): Promise<{
    responses: any[];
    strategyNames: string[];
    timings: {
      total_time: number;
      request_build_time: number;
      opensearch_call: {
        total_time: number;
        network_overhead_estimate?: number;
        subqueries: Record<string, number> & { max_subquery_took: number };
      };
    };
  }> {
    // Map tenant name to short code (e.g., "Illinois 211" -> "il211")
    const tenantShortCode = getTenantShortCode(tenant);
    const indexName = this.getIndexName(tenantShortCode, searchRequest.lang);
    this.logger.debug(`Executing hybrid search on index: ${indexName}`);

    // Track overall phase timing
    const phaseStart = Date.now();

    // Track request building time
    const buildStart = Date.now();

    const filters = this.buildFilters(searchRequest);
    const candidatesPerStrategy = 50; // Configurable

    // Determine pagination mode and calculate offset if needed
    const useOffsetPagination = searchRequest.legacy_offset_pagination;
    const offset = useOffsetPagination
      ? (searchRequest.page - 1) * searchRequest.limit
      : undefined;

    // Build multi-search body
    const msearchBody = [];
    const strategyNames: string[] = [];

    // Check if this is a taxonomy-only search (no text query)
    const isTaxonomyOnlySearch = !searchRequest.q && searchRequest.taxonomies;

    if (isTaxonomyOnlySearch) {
      // For taxonomy-only searches, use a simple match_all query with filters
      this.logger.debug(
        'Taxonomy-only search detected - using match_all strategy',
      );
      strategyNames.push('match_all_filtered');
      msearchBody.push({ index: indexName });
      msearchBody.push(
        this.buildMatchAllQuery(
          filters,
          candidatesPerStrategy,
          searchRequest.search_after,
          searchRequest,
          useOffsetPagination,
          offset,
        ),
      );
    } else if (searchRequest.q && queryEmbedding.length > 0) {
      // Only run semantic strategies if we have a query and embedding
      // Strategy 1: Service-level semantic search
      strategyNames.push('semantic_service');
      msearchBody.push({ index: indexName });
      msearchBody.push(
        this.buildServiceSemanticQuery(
          queryEmbedding,
          filters,
          candidatesPerStrategy,
          searchRequest.search_after,
          searchRequest,
          useOffsetPagination,
          offset,
        ),
      );

      // Strategy 2: Taxonomy-level semantic search
      strategyNames.push('semantic_taxonomy');
      msearchBody.push({ index: indexName });
      msearchBody.push(
        this.buildTaxonomySemanticQuery(
          queryEmbedding,
          filters,
          candidatesPerStrategy,
          searchRequest.search_after,
          searchRequest,
          useOffsetPagination,
          offset,
        ),
      );

      // Strategy 3: Organization-level semantic search
      strategyNames.push('semantic_organization');
      msearchBody.push({ index: indexName });
      msearchBody.push(
        this.buildOrganizationSemanticQuery(
          queryEmbedding,
          filters,
          candidatesPerStrategy,
          searchRequest.search_after,
          searchRequest,
          useOffsetPagination,
          offset,
        ),
      );
    }

    // Strategy 4: Keyword search variations (if enabled)
    // Simplified strategy focusing on semantically meaningful searches:
    // 4a. Original query (preserves full user intent and phrases)
    // 4b. Nouns (POS-tagged, original form - e.g., "laundry")
    // 4c. Stemmed nouns (normalized form - e.g., "laundri" to catch corpus variations)
    if (!searchRequest.disable_intent_classification && searchRequest.q) {
      const keywordVariations = this.generateKeywordVariations(searchRequest.q);

      // Original query search - preserves full user intent
      if (keywordVariations.original) {
        strategyNames.push('keyword_original');
        msearchBody.push({ index: indexName });
        msearchBody.push(
          this.buildKeywordQuery(
            keywordVariations.original,
            filters,
            candidatesPerStrategy,
            searchRequest.search_after,
            searchRequest,
            'original',
            useOffsetPagination,
            offset,
          ),
        );
      }

      // Nouns-only search (original form) - focuses on core concepts
      if (keywordVariations.nouns && keywordVariations.nouns.length > 0) {
        strategyNames.push('keyword_nouns');
        msearchBody.push({ index: indexName });
        msearchBody.push(
          this.buildKeywordQuery(
            keywordVariations.nouns.join(' '),
            filters,
            candidatesPerStrategy,
            searchRequest.search_after,
            searchRequest,
            'nouns',
            useOffsetPagination,
            offset,
          ),
        );
      }

      // Stemmed nouns search - catches corpus variations ("laundry" vs "laundri")
      if (
        keywordVariations.stemmedNouns &&
        keywordVariations.stemmedNouns.length > 0
      ) {
        strategyNames.push('keyword_nouns_stemmed');
        msearchBody.push({ index: indexName });
        msearchBody.push(
          this.buildKeywordQuery(
            keywordVariations.stemmedNouns.join(' '),
            filters,
            candidatesPerStrategy,
            searchRequest.search_after,
            searchRequest,
            'nouns_stemmed',
            useOffsetPagination,
            offset,
          ),
        );
      }
    }

    // Strategy 5: Intent-driven taxonomy search using combined_taxonomy_codes
    // Only execute if we have taxonomy codes and it's not a low-information query
    if (
      intentClassification &&
      intentClassification.combined_taxonomy_codes &&
      intentClassification.combined_taxonomy_codes.length > 0 &&
      !intentClassification.is_low_information_query
    ) {
      this.logger.debug(
        `Adding intent-driven taxonomy search with ${intentClassification.combined_taxonomy_codes.length} codes`,
      );
      strategyNames.push('intent_taxonomy');
      msearchBody.push({ index: indexName });
      msearchBody.push(
        this.buildIntentTaxonomyQuery(
          intentClassification.combined_taxonomy_codes,
          filters,
          candidatesPerStrategy,
          searchRequest.search_after,
          searchRequest,
          useOffsetPagination,
          offset,
        ),
      );
    } else if (intentClassification?.is_low_information_query) {
      this.logger.debug(
        'Skipping intent-driven taxonomy search: low-information query detected',
      );
    }

    const requestBuildTime = Date.now() - buildStart;

    try {
      // Execute multi-search and track timing
      const msearchStart = Date.now();
      const response = await this.client.msearch({
        body: msearchBody,
      });
      const msearchTime = Date.now() - msearchStart;

      // Track individual query timings from OpenSearch response
      const subqueryTimings: Record<string, number> = {};
      let maxSubqueryTook = 0;

      response.body.responses.forEach((resp: any, index: number) => {
        if (resp.took !== undefined && strategyNames[index]) {
          subqueryTimings[strategyNames[index]] = resp.took;
          maxSubqueryTook = Math.max(maxSubqueryTook, resp.took);
        }
      });

      // Calculate network overhead estimate
      const networkOverhead =
        maxSubqueryTook > 0 ? msearchTime - maxSubqueryTook : undefined;

      const totalTime = Date.now() - phaseStart;

      this.logger.debug(
        `OpenSearch phase complete: ${response.body.responses.length} strategy responses received`,
      );

      return {
        responses: response.body.responses,
        strategyNames,
        timings: {
          total_time: totalTime,
          request_build_time: requestBuildTime,
          opensearch_call: {
            total_time: msearchTime,
            network_overhead_estimate: networkOverhead,
            subqueries: {
              ...subqueryTimings,
              max_subquery_took: maxSubqueryTook,
            },
          },
        },
      };
    } catch (error) {
      this.logger.error(
        `OpenSearch query failed: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Build service-level semantic search query
   * Uses KNN on service.embedding field combined with geospatial scoring
   */
  private buildServiceSemanticQuery(
    embedding: number[],
    filters: any[],
    k: number,
    searchAfter?: any[],
    searchRequest?: SearchRequestDto,
    useOffsetPagination?: boolean,
    offset?: number,
  ): any {
    const weights = searchRequest ? this.getWeights(searchRequest) : null;
    const semanticWeight =
      (weights?.semantic.service ?? 1.0) *
      (weights?.strategies.semantic_search ?? 1.0);

    const query: any = {
      size: k,
      query: {
        function_score: {
          query: {
            nested: {
              path: 'service',
              query: {
                knn: {
                  'service.embedding': {
                    vector: embedding,
                    k: k,
                  },
                },
              },
              score_mode: 'max',
            },
          },
          functions: [],
          score_mode: 'multiply', // Combine semantic and geospatial scores
          boost_mode: 'replace',
          boost: semanticWeight,
        },
      },
      sort: [
        { _score: 'desc' },
        { _id: 'asc' }, // Tiebreaker for consistent pagination
      ],
    };

    // Add geospatial scoring if location is provided
    if (searchRequest) {
      const geoScoreFunction = this.buildGeospatialScoreFunction(searchRequest);
      if (geoScoreFunction) {
        query.query.function_score.functions.push(geoScoreFunction);
      }
    }

    // Add pagination: either cursor-based (search_after) or offset-based (from)
    if (useOffsetPagination && offset !== undefined) {
      query.from = offset;
    } else if (searchAfter && searchAfter.length > 0) {
      query.search_after = searchAfter;
    }

    // Add filters if present
    if (filters.length > 0) {
      query.query.function_score.query = {
        bool: {
          must: [query.query.function_score.query],
          filter: filters,
        },
      };
    }

    return query;
  }

  /**
   * Build taxonomy-level semantic search query
   * Uses KNN on taxonomies[].embedding field combined with geospatial scoring
   */
  private buildTaxonomySemanticQuery(
    embedding: number[],
    filters: any[],
    k: number,
    searchAfter?: any[],
    searchRequest?: SearchRequestDto,
    useOffsetPagination?: boolean,
    offset?: number,
  ): any {
    const weights = searchRequest ? this.getWeights(searchRequest) : null;
    const semanticWeight =
      (weights?.semantic.taxonomy ?? 1.0) *
      (weights?.strategies.semantic_search ?? 1.0);

    const query: any = {
      size: k,
      query: {
        function_score: {
          query: {
            nested: {
              path: 'taxonomies',
              query: {
                knn: {
                  'taxonomies.embedding': {
                    vector: embedding,
                    k: k,
                  },
                },
              },
              score_mode: 'max',
            },
          },
          functions: [],
          score_mode: 'multiply', // Combine semantic and geospatial scores
          boost_mode: 'replace',
          boost: semanticWeight,
        },
      },
      sort: [
        { _score: 'desc' },
        { _id: 'asc' }, // Tiebreaker for consistent pagination
      ],
    };

    // Add geospatial scoring if location is provided
    if (searchRequest) {
      const geoScoreFunction = this.buildGeospatialScoreFunction(searchRequest);
      if (geoScoreFunction) {
        query.query.function_score.functions.push(geoScoreFunction);
      }
    }

    // Add pagination: either cursor-based (search_after) or offset-based (from)
    if (useOffsetPagination && offset !== undefined) {
      query.from = offset;
    } else if (searchAfter && searchAfter.length > 0) {
      query.search_after = searchAfter;
    }

    // Add filters if present
    if (filters.length > 0) {
      query.query.function_score.query = {
        bool: {
          must: [query.query.function_score.query],
          filter: filters,
        },
      };
    }

    return query;
  }

  /**
   * Build organization-level semantic search query
   * Uses KNN on organization.embedding field combined with geospatial scoring
   */
  private buildOrganizationSemanticQuery(
    embedding: number[],
    filters: any[],
    k: number,
    searchAfter?: any[],
    searchRequest?: SearchRequestDto,
    useOffsetPagination?: boolean,
    offset?: number,
  ): any {
    const weights = searchRequest ? this.getWeights(searchRequest) : null;
    const semanticWeight =
      (weights?.semantic.organization ?? 1.0) *
      (weights?.strategies.semantic_search ?? 1.0);

    const query: any = {
      size: k,
      query: {
        function_score: {
          query: {
            nested: {
              path: 'organization',
              query: {
                knn: {
                  'organization.embedding': {
                    vector: embedding,
                    k: k,
                  },
                },
              },
              score_mode: 'max',
            },
          },
          functions: [],
          score_mode: 'multiply', // Combine semantic and geospatial scores
          boost_mode: 'replace',
          boost: semanticWeight,
        },
      },
      sort: [
        { _score: 'desc' },
        { _id: 'asc' }, // Tiebreaker for consistent pagination
      ],
    };

    // Add geospatial scoring if location is provided
    if (searchRequest) {
      const geoScoreFunction = this.buildGeospatialScoreFunction(searchRequest);
      if (geoScoreFunction) {
        query.query.function_score.functions.push(geoScoreFunction);
      }
    }

    // Add pagination: either cursor-based (search_after) or offset-based (from)
    if (useOffsetPagination && offset !== undefined) {
      query.from = offset;
    } else if (searchAfter && searchAfter.length > 0) {
      query.search_after = searchAfter;
    }

    // Add filters if present
    if (filters.length > 0) {
      query.query.function_score.query = {
        bool: {
          must: [query.query.function_score.query],
          filter: filters,
        },
      };
    }

    return query;
  }

  /**
   * Extract nouns from query using POS tagging
   * Used for both keyword search variations and relevant text extraction
   */
  private extractNouns(query: string): string[] {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const nouns: string[] = [];
    try {
      const doc = this.nlpEngine.readDoc(query);
      doc
        .tokens()
        .filter(
          (t: any) =>
            !t.parentEntity() &&
            (t.out(this.its.pos) === 'NOUN' || t.out(this.its.pos) === 'PROPN'),
        )
        .each((t: any) => nouns.push(t.out(this.its.normal)));
    } catch (posError) {
      this.logger.warn(
        `POS tagging failed: ${posError.message}, skipping noun extraction`,
      );
    }
    return nouns;
  }

  /**
   * Generate keyword search variations from the original query
   * Simplified strategy focusing on semantically meaningful searches:
   * - original: Full query preserving user intent and phrases
   * - nouns: POS-tagged nouns in original form (e.g., "laundry")
   * - stemmedNouns: Stemmed nouns to catch corpus variations (e.g., "laundri")
   */
  private generateKeywordVariations(query: string): {
    original: string;
    nouns: string[];
    stemmedNouns: string[];
  } {
    if (!query || query.trim().length === 0) {
      return { original: query, nouns: [], stemmedNouns: [] };
    }

    try {
      // Extract nouns using POS tagging (most semantically important)
      const nouns = this.extractNouns(query);
      const stemmedNouns = nouns.map((noun) => nlp.string.stem(noun));

      this.logger.debug(
        `Keyword variations - Original: "${query}", Nouns: [${nouns.join(', ')}], Stemmed Nouns: [${stemmedNouns.join(', ')}]`,
      );

      return {
        original: query,
        nouns,
        stemmedNouns,
      };
    } catch (error) {
      this.logger.warn(
        `Keyword variation generation failed: ${error.message}, using original query`,
      );
      return { original: query, nouns: [], stemmedNouns: [] };
    }
  }

  /**
   * Build keyword search query
   * Uses multi_match across text fields combined with geospatial scoring
   * @param variationType - Type of keyword variation: 'original', 'nouns', or 'nouns_stemmed'
   */
  private buildKeywordQuery(
    query: string,
    filters: any[],
    size: number,
    searchAfter?: any[],
    searchRequest?: SearchRequestDto,
    variationType: 'original' | 'nouns' | 'nouns_stemmed' = 'original',
    useOffsetPagination?: boolean,
    offset?: number,
  ): any {
    const weights = searchRequest ? this.getWeights(searchRequest) : null;
    let keywordWeight = weights?.strategies.keyword_search ?? 1.0;

    // Adjust weight based on variation type using configured multipliers
    // Original query gets highest weight (preserves full user intent)
    // Nouns get high weight (semantically focused on core concepts)
    // Stemmed nouns get slightly lower weight (catches variations but less precise)
    const multipliers =
      this.weightsConfigService.getKeywordVariationMultipliers();
    if (variationType === 'nouns') {
      keywordWeight *= multipliers.nouns_multiplier;
    } else if (variationType === 'nouns_stemmed') {
      keywordWeight *= multipliers.stemmed_nouns_multiplier;
    }

    this.logger.debug(
      `Building keyword query [${variationType}]: "${query}" (weight: ${keywordWeight})`,
    );

    const queryBody: any = {
      size: size,
      query: {
        function_score: {
          query: {
            bool: {
              must: [
                {
                  multi_match: {
                    query: query,
                    fields: [
                      'name^3',
                      'description^2',
                      'summary',
                      'service.name^3',
                      'service.description^2',
                      'organization.name^2',
                      'taxonomies.name',
                      'taxonomies.description',
                    ],
                    type: 'best_fields',
                    operator:
                      variationType === 'nouns' ||
                      variationType === 'nouns_stemmed'
                        ? 'or'
                        : 'and',
                  },
                },
              ],
              filter: filters,
            },
          },
          functions: [],
          score_mode: 'multiply', // Combine keyword and geospatial scores
          boost_mode: 'replace',
          boost: keywordWeight,
        },
      },
      sort: [
        { _score: 'desc' },
        { _id: 'asc' }, // Tiebreaker for consistent pagination
      ],
    };

    // Add geospatial scoring if location is provided
    if (searchRequest) {
      const geoScoreFunction = this.buildGeospatialScoreFunction(searchRequest);
      if (geoScoreFunction) {
        queryBody.query.function_score.functions.push(geoScoreFunction);
      }
    }

    // Add pagination: either cursor-based (search_after) or offset-based (from)
    if (useOffsetPagination && offset !== undefined) {
      queryBody.from = offset;
    } else if (searchAfter && searchAfter.length > 0) {
      queryBody.search_after = searchAfter;
    }

    return queryBody;
  }

  /**
   * Build intent-driven taxonomy query
   * Searches for services matching any of the provided taxonomy codes with geospatial scoring
   * @param taxonomyCodes - Array of taxonomy codes from intent classification
   * @param filters - Additional filters to apply
   * @param size - Number of results to return
   */
  private buildIntentTaxonomyQuery(
    taxonomyCodes: string[],
    filters: any[],
    size: number,
    searchAfter?: any[],
    searchRequest?: SearchRequestDto,
    useOffsetPagination?: boolean,
    offset?: number,
  ): any {
    const weights = searchRequest ? this.getWeights(searchRequest) : null;
    const intentWeight = weights?.strategies.intent_driven ?? 1.0;

    // Search for any service that has at least one of the taxonomy codes
    const queryBody: any = {
      size: size,
      query: {
        function_score: {
          query: {
            bool: {
              must: [
                {
                  nested: {
                    path: 'taxonomies',
                    query: {
                      terms: {
                        'taxonomies.code': taxonomyCodes,
                      },
                    },
                  },
                },
              ],
              filter: filters,
            },
          },
          functions: [],
          score_mode: 'multiply', // Combine taxonomy match and geospatial scores
          boost_mode: 'replace',
          boost: intentWeight,
        },
      },
      sort: [
        { _score: 'desc' },
        { _id: 'asc' }, // Tiebreaker for consistent pagination
      ],
    };

    // Add geospatial scoring if location is provided
    if (searchRequest) {
      const geoScoreFunction = this.buildGeospatialScoreFunction(searchRequest);
      if (geoScoreFunction) {
        queryBody.query.function_score.functions.push(geoScoreFunction);
      }
    }

    // Add pagination: either cursor-based (search_after) or offset-based (from)
    if (useOffsetPagination && offset !== undefined) {
      queryBody.from = offset;
    } else if (searchAfter && searchAfter.length > 0) {
      queryBody.search_after = searchAfter;
    }

    return queryBody;
  }

  /**
   * Build match_all query for taxonomy-only searches
   * Used when no text query is provided but taxonomy filters are specified
   * Returns all documents matching the filters, scored by geospatial proximity if provided
   *
   * @param filters - Array of filter objects (taxonomy, geospatial, etc.)
   * @param size - Number of results to return
   * @param searchAfter - Cursor for pagination
   * @param searchRequest - Full search request for geospatial scoring
   * @returns OpenSearch query object
   */
  private buildMatchAllQuery(
    filters: any[],
    size: number,
    searchAfter?: any[],
    searchRequest?: SearchRequestDto,
    useOffsetPagination?: boolean,
    offset?: number,
  ): any {
    const query: any = {
      size: size,
      query: {
        bool: {
          must: {
            match_all: {},
          },
          filter: filters,
        },
      },
      sort: [
        { _score: 'desc' },
        { _id: 'asc' }, // Tiebreaker for consistent pagination
      ],
    };

    // If geospatial location is provided, add function_score for proximity ranking
    if (searchRequest?.lat && searchRequest?.lon) {
      const geoScoreFunction = this.buildGeospatialScoreFunction(searchRequest);
      if (geoScoreFunction) {
        query.query = {
          function_score: {
            query: query.query,
            functions: [geoScoreFunction],
            score_mode: 'multiply',
            boost_mode: 'replace',
          },
        };
      }
    }

    // Add pagination: either cursor-based (search_after) or offset-based (from)
    if (useOffsetPagination && offset !== undefined) {
      query.from = offset;
    } else if (searchAfter && searchAfter.length > 0) {
      query.search_after = searchAfter;
    }

    return query;
  }

  /**
   * Build taxonomy filters from AND/OR query structure
   * Used for explicit taxonomy queries from the search request
   *
   * Supports two modes:
   * - AND: All specified taxonomy codes must match (each code becomes a separate filter)
   * - OR: Any of the specified taxonomy codes can match (single filter with terms query)
   *
   * These filters are applied to ALL search strategies (semantic, keyword, intent-driven)
   * to ensure results match the user's taxonomy requirements
   *
   * @param taxonomyQuery - Object with AND and/OR arrays of taxonomy codes
   * @returns Array of OpenSearch filter objects
   */
  private buildTaxonomyFilters(taxonomyQuery: any): any[] {
    const filters: any[] = [];

    if (taxonomyQuery.AND && taxonomyQuery.AND.length > 0) {
      // All taxonomy codes must match
      // Each code becomes a separate filter (AND logic at the bool level)
      taxonomyQuery.AND.forEach((code: string) => {
        filters.push({
          nested: {
            path: 'taxonomies',
            query: {
              term: {
                'taxonomies.code': code,
              },
            },
          },
        });
      });

      this.logger.debug(
        `Built ${taxonomyQuery.AND.length} AND taxonomy filters: [${taxonomyQuery.AND.join(', ')}]`,
      );
    }

    if (taxonomyQuery.OR && taxonomyQuery.OR.length > 0) {
      // Any taxonomy code can match
      // Single filter with terms query (OR logic within the filter)
      filters.push({
        nested: {
          path: 'taxonomies',
          query: {
            terms: {
              'taxonomies.code': taxonomyQuery.OR,
            },
          },
        },
      });

      this.logger.debug(
        `Built OR taxonomy filter with ${taxonomyQuery.OR.length} codes: [${taxonomyQuery.OR.join(', ')}]`,
      );
    }

    return filters;
  }

  /**
   * Extract and merge weights from multiple sources with priority:
   * 1. Request-level custom_weights (highest priority)
   * 2. Configuration file defaults (from weights-config.service)
   */
  private getWeights(searchRequest: SearchRequestDto) {
    const configDefaults = this.weightsConfigService.getConfig();

    return {
      semantic: {
        service:
          searchRequest.custom_weights?.semantic?.service ??
          configDefaults.semantic.service,
        taxonomy:
          searchRequest.custom_weights?.semantic?.taxonomy ??
          configDefaults.semantic.taxonomy,
        organization:
          searchRequest.custom_weights?.semantic?.organization ??
          configDefaults.semantic.organization,
      },
      strategies: {
        semantic_search:
          searchRequest.custom_weights?.strategies?.semantic_search ??
          configDefaults.strategies.semantic_search,
        keyword_search:
          searchRequest.custom_weights?.strategies?.keyword_search ??
          configDefaults.strategies.keyword_search,
        intent_driven:
          searchRequest.custom_weights?.strategies?.intent_driven ??
          configDefaults.strategies.intent_driven,
      },
      geospatial: {
        weight:
          searchRequest.custom_weights?.geospatial?.weight ??
          configDefaults.geospatial.weight,
        decay_scale:
          searchRequest.custom_weights?.geospatial?.decay_scale ??
          searchRequest.distance ??
          configDefaults.geospatial.decay_scale,
        decay_offset:
          searchRequest.custom_weights?.geospatial?.decay_offset ??
          configDefaults.geospatial.decay_offset,
      },
    };
  }

  /**
   * Build geospatial scoring function for distance decay
   * Uses Gaussian decay function to score based on distance from user location
   */
  private buildGeospatialScoreFunction(searchRequest: SearchRequestDto): any {
    if (!searchRequest.lat || !searchRequest.lon) {
      return null;
    }

    const weights = this.getWeights(searchRequest);
    const decay = 0.5; // decay factor at scale distance

    return {
      gauss: {
        'location.point': {
          origin: {
            lat: searchRequest.lat,
            lon: searchRequest.lon,
          },
          scale: `${weights.geospatial.decay_scale}mi`,
          offset: `${weights.geospatial.decay_offset}mi`,
          decay: decay,
        },
      },
    };
  }

  /**
   * Add distance information to search results if location is provided
   */
  public addDistanceInfo(hits: any[], searchRequest: SearchRequestDto): any[] {
    if (!searchRequest.lat || !searchRequest.lon) {
      return hits;
    }

    return hits.map((hit) => {
      const enhancedHit = { ...hit };

      // Calculate distance if location exists
      if (
        hit._source?.location?.point?.lat &&
        hit._source?.location?.point?.lon
      ) {
        const distance = this.calculateDistance(
          searchRequest.lat,
          searchRequest.lon,
          hit._source.location.point.lat,
          hit._source.location.point.lon,
        );

        enhancedHit._source.distance_from_user =
          Math.round(distance * 100) / 100; // Round to 2 decimal places
      }

      return enhancedHit;
    });
  }

  /**
   * Add relevant text snippets to results to explain why they were surfaced
   * Extracts sentences containing query nouns to help users understand relevance
   */
  public addRelevantTextSnippets(results: any[], query: string): any[] {
    if (!query || results.length === 0) {
      return results;
    }

    // Extract nouns from the query
    const queryNouns = this.extractNouns(query);
    if (queryNouns.length === 0) {
      return results;
    }

    this.logger.debug(
      `Extracting relevant text snippets for nouns: [${queryNouns.join(', ')}]`,
    );

    return results.map((result) => {
      const relevantSnippets = this.findRelevantSnippets(
        result._source,
        queryNouns,
      );

      if (relevantSnippets.length > 0) {
        return {
          ...result,
          relevant_text: relevantSnippets,
        };
      }

      return result;
    });
  }

  /**
   * Find sentences in the document that contain query nouns
   * Returns up to 3 most relevant snippets
   */
  private findRelevantSnippets(source: any, queryNouns: string[]): string[] {
    const snippets: Array<{ text: string; score: number }> = [];

    // Fields to search for relevant text (in priority order)
    const fieldsToSearch = [
      { path: 'description', weight: 3 },
      { path: 'service.description', weight: 3 },
      { path: 'summary', weight: 2 },
      { path: 'service.summary', weight: 2 },
      { path: 'schedule', weight: 1 },
    ];

    for (const field of fieldsToSearch) {
      const text = this.getNestedValue(source, field.path);
      if (!text || typeof text !== 'string') continue;

      // Split into sentences (simple approach)
      const sentences = text
        .split(/[.!?]\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 20); // Filter out very short fragments

      for (const sentence of sentences) {
        const lowerSentence = sentence.toLowerCase();
        let matchCount = 0;

        // Count how many query nouns appear in this sentence
        for (const noun of queryNouns) {
          const lowerNoun = noun.toLowerCase();
          // Check for exact match or stemmed match
          if (
            lowerSentence.includes(lowerNoun) ||
            lowerSentence.includes(nlp.string.stem(lowerNoun))
          ) {
            matchCount++;
          }
        }

        if (matchCount > 0) {
          // Score based on match count and field weight
          const score = matchCount * field.weight;
          snippets.push({ text: sentence, score });
        }
      }
    }

    // Sort by score (descending) and return top 3 unique snippets
    const sortedSnippets = snippets.sort((a, b) => b.score - a.score);
    const uniqueSnippets = Array.from(
      new Set(sortedSnippets.map((s) => s.text)),
    ).slice(0, 3);

    return uniqueSnippets;
  }

  /**
   * Get nested value from object using dot notation path
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * Build filters for OpenSearch query
   * Handles tenant, locale, optional geospatial distance filtering, and taxonomy queries
   */
  private buildFilters(searchRequest: SearchRequestDto): any[] {
    const filters: any[] = [];

    // Geospatial distance filter (hard filter)
    if (searchRequest.lat && searchRequest.lon && searchRequest.distance) {
      filters.push({
        geo_distance: {
          distance: `${searchRequest.distance}mi`,
          'location.point': {
            lat: searchRequest.lat,
            lon: searchRequest.lon,
          },
        },
      });
    }

    // Taxonomy query filters (AND/OR logic)
    if (searchRequest.taxonomies) {
      const taxonomyFilters = this.buildTaxonomyFilters(
        searchRequest.taxonomies,
      );
      filters.push(...taxonomyFilters);

      if (taxonomyFilters.length > 0) {
        this.logger.debug(
          `Applied ${taxonomyFilters.length} taxonomy filter(s) from taxonomies field`,
        );
      }
    }

    return filters;
  }

  /**
   * Combine and deduplicate results from all search strategies
   * Keeps the best score for each unique document and tracks detailed source contributions
   * Returns both the combined results and the total count of unique matching documents
   */
  public combineSearchResults(
    responses: any[],
    strategyNames: string[],
  ): { results: any[]; totalResults: number } {
    // First pass: normalize scores within each strategy to 0-1 scale
    const normalizedResponses = this.normalizeStrategyScores(
      responses,
      strategyNames,
    );

    const resultMap = new Map<string, any>();

    normalizedResponses.forEach((response, index) => {
      if (!response.hits?.hits) return;

      const strategyName = strategyNames[index];

      response.hits.hits.forEach((hit: any) => {
        const existingHit = resultMap.get(hit._id);

        // Track detailed source contributions with normalized scores
        const sourceContributions = existingHit?._source_contributions || [];
        sourceContributions.push({
          strategy: strategyName,
          pre_weight_score: hit._normalized_score, // Normalized 0-1 score
          original_score: hit._original_score, // Original raw score for reference
          strategy_weight: 1.0, // Placeholder, will be set in main service
          weighted_score: hit._score, // Final weighted score
        });

        // Keep the hit with the highest weighted score
        if (!existingHit || hit._score > existingHit._score) {
          resultMap.set(hit._id, {
            ...hit,
            _source_contributions: sourceContributions,
          });
        } else {
          // Update source contributions even if we're not replacing the hit
          existingHit._source_contributions = sourceContributions;
        }
      });
    });

    // Convert map to array and sort by score
    const results = Array.from(resultMap.values()).sort(
      (a, b) => b._score - a._score,
    );

    // The total is the number of unique documents that matched across all strategies
    let totalResults = 0;

    responses.forEach((response) => {
      const value = response?.hits?.total?.value;
      if (typeof value === 'number' && value > totalResults) {
        totalResults = value;
      }
    });

    return { results, totalResults };
  }

  /**
   * Calculate distance between two points using Haversine formula
   * Returns distance in miles
   */
  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 3959; // Earth's radius in miles
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Convert degrees to radians
   */
  private toRad(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }

  /**
   * Normalize scores within each strategy to 0-1 scale using min-max normalization
   * This ensures all strategies (semantic KNN, keyword BM25, etc.) are comparable
   */
  private normalizeStrategyScores(
    responses: any[],
    strategyNames: string[],
  ): any[] {
    return responses.map((response, index) => {
      if (!response.hits?.hits || response.hits.hits.length === 0) {
        return response;
      }

      const hits = response.hits.hits;
      const strategyName = strategyNames[index];

      // Find min and max scores for this strategy
      const scores = hits.map((hit: any) => hit._score);
      const minScore = Math.min(...scores);
      const maxScore = Math.max(...scores);
      const scoreRange = maxScore - minScore;

      // Normalize each hit's score to 0-1 range
      const normalizedHits = hits.map((hit: any) => {
        let normalizedScore: number;

        if (scoreRange === 0) {
          // All scores are the same, set to 1.0
          normalizedScore = 1.0;
        } else {
          // Min-max normalization: (score - min) / (max - min)
          normalizedScore = (hit._score - minScore) / scoreRange;
        }

        this.logger.debug(
          `[${strategyName}] Normalized score: ${hit._score.toFixed(4)} -> ${normalizedScore.toFixed(4)} (range: ${minScore.toFixed(4)}-${maxScore.toFixed(4)})`,
        );

        return {
          ...hit,
          _original_score: hit._score, // Keep original for reference
          _normalized_score: normalizedScore, // Normalized 0-1 score
          _score: normalizedScore, // Use normalized score for ranking
        };
      });

      return {
        ...response,
        hits: {
          ...response.hits,
          hits: normalizedHits,
        },
      };
    });
  }

  /**
   * Mock search results for testing
   */
  private getMockSearchResults(): any[] {
    return [
      {
        _index: 'test-resources_en',
        _id: 'mock-1',
        _score: 0.95,
        _source: {
          id: 'mock-1',
          name: 'Mock Resource 1',
          description: 'This is a mock resource for testing',
          service: {
            name: 'Mock Service',
            description: 'Mock service description',
            embedding: [], // Will be removed in post-processing
          },
          organization: {
            name: 'Mock Organization',
            embedding: [], // Will be removed in post-processing
          },
          taxonomies: [
            {
              code: 'TEST-001',
              name: 'Test Taxonomy',
              embedding: [], // Will be removed in post-processing
            },
          ],
          location: {
            name: 'Mock Location',
            point: {
              lat: 47.751076,
              lon: -120.740135,
            },
          },
        },
      },
    ];
  }
}
