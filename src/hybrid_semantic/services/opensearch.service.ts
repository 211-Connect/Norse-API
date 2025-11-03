import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@opensearch-project/opensearch';
import { SearchRequestDto } from '../dto/search-request.dto';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { getTenantShortCode } from '../config/tenant-mapping.config';

/**
 * Service for building and executing OpenSearch queries
 * Handles multi-search (_msearch) for hybrid semantic search
 */
@Injectable()
export class OpenSearchService {
  private readonly logger = new Logger(OpenSearchService.name);
  private readonly client: Client;

  constructor(private readonly configService: ConfigService) {
    const node =
      this.configService.get<string>('OPENSEARCH_NODE') ||
      'http://localhost:9200';
    this.client = new Client({
      node,
      ssl: {
        rejectUnauthorized: false, // For development; configure properly for production
      },
    });
    this.logger.log(`OpenSearch client initialized with node: ${node}`);
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
  ): Promise<any[]> {
    // Map tenant name to short code (e.g., "Illinois 211" -> "il211")
    const tenantShortCode = getTenantShortCode(tenant);
    const indexName = this.getIndexName(tenantShortCode, searchRequest.lang);
    this.logger.debug(`Executing hybrid search on index: ${indexName}`);

    const filters = this.buildFilters(searchRequest);
    const candidatesPerStrategy = 50; // Configurable

    // Build multi-search body
    const msearchBody = [];

    // Strategy 1: Service-level semantic search
    msearchBody.push({ index: indexName });
    msearchBody.push(
      this.buildServiceSemanticQuery(
        queryEmbedding,
        filters,
        candidatesPerStrategy,
        searchRequest.search_after,
        searchRequest,
      ),
    );

    // Strategy 2: Taxonomy-level semantic search
    msearchBody.push({ index: indexName });
    msearchBody.push(
      this.buildTaxonomySemanticQuery(
        queryEmbedding,
        filters,
        candidatesPerStrategy,
        searchRequest.search_after,
        searchRequest,
      ),
    );

    // Strategy 3: Organization-level semantic search
    msearchBody.push({ index: indexName });
    msearchBody.push(
      this.buildOrganizationSemanticQuery(
        queryEmbedding,
        filters,
        candidatesPerStrategy,
        searchRequest.search_after,
        searchRequest,
      ),
    );

    // Strategy 4: Keyword search (if enabled)
    if (!searchRequest.disable_intent_classification && searchRequest.q) {
      msearchBody.push({ index: indexName });
      msearchBody.push(
        this.buildKeywordQuery(
          searchRequest.q,
          filters,
          candidatesPerStrategy,
          searchRequest.search_after,
          searchRequest,
        ),
      );
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
      msearchBody.push({ index: indexName });
      msearchBody.push(
        this.buildIntentTaxonomyQuery(
          intentClassification.combined_taxonomy_codes,
          filters,
          candidatesPerStrategy,
          searchRequest.search_after,
          searchRequest,
        ),
      );
    } else if (intentClassification?.is_low_information_query) {
      this.logger.debug(
        'Skipping intent-driven taxonomy search: low-information query detected',
      );
    }

    try {
      // Execute multi-search
      const response = await this.client.msearch({
        body: msearchBody,
      });

      // Combine and deduplicate results from all strategies
      const combinedResults = this.combineSearchResults(
        response.body.responses,
      );

      // Add distance information to results
      const resultsWithDistance = this.addDistanceInfo(
        combinedResults,
        searchRequest,
      );

      this.logger.debug(
        `Hybrid search returned ${resultsWithDistance.length} unique results`,
      );

      return resultsWithDistance;
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

    // Add search_after for cursor-based pagination
    if (searchAfter && searchAfter.length > 0) {
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

    // Add search_after for cursor-based pagination
    if (searchAfter && searchAfter.length > 0) {
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

    // Add search_after for cursor-based pagination
    if (searchAfter && searchAfter.length > 0) {
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
   * Build keyword search query
   * Uses multi_match across text fields combined with geospatial scoring
   */
  private buildKeywordQuery(
    query: string,
    filters: any[],
    size: number,
    searchAfter?: any[],
    searchRequest?: SearchRequestDto,
  ): any {
    const weights = searchRequest ? this.getWeights(searchRequest) : null;
    const keywordWeight = weights?.strategies.keyword_search ?? 1.0;

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

    // Add search_after for cursor-based pagination
    if (searchAfter && searchAfter.length > 0) {
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

    // Add search_after for cursor-based pagination
    if (searchAfter && searchAfter.length > 0) {
      queryBody.search_after = searchAfter;
    }

    return queryBody;
  }

  /**
   * Build taxonomy filters from AND/OR query structure
   * Used for explicit taxonomy queries from the search request
   */
  private buildTaxonomyFilters(taxonomyQuery: any): any[] {
    const filters: any[] = [];

    if (taxonomyQuery.AND && taxonomyQuery.AND.length > 0) {
      // All taxonomy codes must match
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
    }

    if (taxonomyQuery.OR && taxonomyQuery.OR.length > 0) {
      // Any taxonomy code can match
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
    }

    return filters;
  }

  /**
   * Extract weight configuration from search request
   * Supports both custom_weights object and legacy individual parameters
   */
  private getWeights(searchRequest: SearchRequestDto) {
    return {
      semantic: {
        service:
          searchRequest.custom_weights?.semantic?.service ??
          searchRequest.semantic_weight ??
          1.0,
        taxonomy:
          searchRequest.custom_weights?.semantic?.taxonomy ??
          searchRequest.taxonomy_weight ??
          1.0,
        organization:
          searchRequest.custom_weights?.semantic?.organization ??
          searchRequest.attribute_weight ??
          1.0,
      },
      strategies: {
        semantic_search:
          searchRequest.custom_weights?.strategies?.semantic_search ?? 1.0,
        keyword_search:
          searchRequest.custom_weights?.strategies?.keyword_search ?? 1.0,
        intent_driven:
          searchRequest.custom_weights?.strategies?.intent_driven ?? 1.0,
      },
      geospatial: {
        weight:
          searchRequest.custom_weights?.geospatial?.weight ??
          searchRequest.geospatial_weight ??
          2.0,
        decay_scale:
          searchRequest.custom_weights?.geospatial?.decay_scale ??
          searchRequest.distance_decay_scale ??
          searchRequest.distance ??
          50,
        decay_offset:
          searchRequest.custom_weights?.geospatial?.decay_offset ??
          searchRequest.distance_decay_offset ??
          0,
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
      weight: weights.geospatial.weight,
    };
  }

  /**
   * Build common filters (geospatial distance, facets, etc.)
   * Note: Geospatial distance provides hard filtering, while scoring provides proximity weighting
   */
  private buildFilters(searchRequest: SearchRequestDto): any[] {
    const filters: any[] = [];

    // Geospatial distance filter (hard cutoff)
    if (searchRequest.lat && searchRequest.lon && searchRequest.distance) {
      filters.push({
        nested: {
          path: 'location',
          query: {
            geo_distance: {
              distance: `${searchRequest.distance}mi`,
              'location.point': {
                lat: searchRequest.lat,
                lon: searchRequest.lon,
              },
            },
          },
        },
      });
    }

    // Location point only filter (ensure location exists)
    if (searchRequest.location_point_only) {
      filters.push({
        nested: {
          path: 'location',
          query: {
            exists: {
              field: 'location.point',
            },
          },
        },
      });
    }

    // Facet filters (OR within field, AND across fields)
    if (searchRequest.facets) {
      Object.entries(searchRequest.facets).forEach(([facetField, values]) => {
        if (values && values.length > 0) {
          filters.push({
            terms: {
              [`facets.${facetField}`]: values,
            },
          });
        }
      });
    }

    return filters;
  }

  /**
   * Calculate distance from user location to result location
   * Uses Haversine formula for great-circle distance
   */
  private calculateDistance(
    userLat: number,
    userLon: number,
    resultLat: number,
    resultLon: number,
  ): number {
    const R = 3959; // Earth's radius in miles
    const dLat = this.toRadians(resultLat - userLat);
    const dLon = this.toRadians(resultLon - userLon);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(userLat)) *
        Math.cos(this.toRadians(resultLat)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Add distance information to search results if location is provided
   */
  private addDistanceInfo(hits: any[], searchRequest: SearchRequestDto): any[] {
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
   * Combine and deduplicate results from multiple search strategies
   * Enhanced to preserve the best scores from different strategies
   */
  private combineSearchResults(responses: any[]): any[] {
    const seenIds = new Set<string>();
    const idToBestHit = new Map<string, any>();

    responses.forEach((response) => {
      if (response.hits && response.hits.hits) {
        response.hits.hits.forEach((hit: any) => {
          if (!seenIds.has(hit._id)) {
            seenIds.add(hit._id);
            idToBestHit.set(hit._id, hit);
          } else {
            // If we've seen this ID before, keep the hit with the higher score
            const existingHit = idToBestHit.get(hit._id);
            if (hit._score > existingHit._score) {
              idToBestHit.set(hit._id, hit);
            }
          }
        });
      }
    });

    // Convert map back to array and sort by score
    const combinedHits = Array.from(idToBestHit.values());
    combinedHits.sort((a, b) => b._score - a._score);

    return combinedHits;
  }

  /**
   * Test method to verify custom weights and geospatial scoring functionality
   */
  async testCustomWeights(): Promise<any> {
    this.logger.log('Testing custom weights and geospatial scoring...');

    // Test distance calculation
    const distance = this.calculateDistance(
      47.6062,
      -122.3321,
      47.751076,
      -120.740135,
    ); // Seattle to Wenatchee
    this.logger.log(`Test distance calculation: ${distance.toFixed(2)} miles`);

    // Test with custom_weights object
    const testRequestWithCustomWeights: SearchRequestDto = {
      q: 'food bank',
      lat: 47.6062,
      lon: -122.3321,
      custom_weights: {
        semantic: {
          service: 2.0,
          taxonomy: 1.5,
          organization: 1.0,
        },
        strategies: {
          semantic_search: 1.5,
          keyword_search: 0.8,
          intent_driven: 1.2,
        },
        geospatial: {
          weight: 3.0,
          decay_scale: 25,
          decay_offset: 2,
        },
      },
    };

    const weights = this.getWeights(testRequestWithCustomWeights);
    const geoScoreFunction = this.buildGeospatialScoreFunction(
      testRequestWithCustomWeights,
    );

    this.logger.log('Extracted weights:', JSON.stringify(weights, null, 2));
    this.logger.log(
      'Geospatial score function:',
      JSON.stringify(geoScoreFunction, null, 2),
    );

    return {
      distance_calculation: distance,
      extracted_weights: weights,
      geospatial_function: geoScoreFunction,
      status: 'success',
    };
  }

  /**
   * Check OpenSearch cluster health
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

  /**
   * Check if an index exists
   */
  async indexExists(indexName: string): Promise<boolean> {
    try {
      const response = await this.client.indices.exists({ index: indexName });
      return response.body === true;
    } catch (error) {
      this.logger.error(`Failed to check index existence: ${error.message}`);
      return false;
    }
  }

  /**
   * Strip embedding vectors from search results to reduce payload size
   * Removes embedding fields from service, organization, and taxonomies
   */
  stripEmbeddings(hits: any[]): any[] {
    return hits.map((hit) => {
      const source = { ...hit._source };

      // Remove top-level embedding
      if (source.embedding) {
        delete source.embedding;
      }

      // Remove service embedding
      if (source.service?.embedding) {
        delete source.service.embedding;
      }

      // Remove organization embedding
      if (source.organization?.embedding) {
        delete source.organization.embedding;
      }

      // Remove taxonomy embeddings
      if (source.taxonomies && Array.isArray(source.taxonomies)) {
        source.taxonomies = source.taxonomies.map((taxonomy: any) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { embedding, ...rest } = taxonomy;
          return rest;
        });
      }

      return {
        ...hit,
        _source: source,
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
