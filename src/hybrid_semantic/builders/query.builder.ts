import { Injectable } from '@nestjs/common';
import { SearchRequestDto } from '../dto/search-request.dto';
import { WeightResolver } from '../resolvers/weight.resolver';

/**
 * Fluent builder for constructing OpenSearch queries
 * Eliminates duplicated query structure code across multiple query builders
 */
@Injectable()
export class QueryBuilder {
  private query: any;
  private functions: any[];

  constructor(private readonly weightResolver: WeightResolver) {
    this.reset();
  }

  /**
   * Reset the builder to initial state
   */
  reset(): this {
    this.query = {
      size: 50,
      sort: [
        { _score: 'desc' },
        { _id: 'asc' }, // Tiebreaker for consistent pagination
      ],
    };
    this.functions = [];
    return this;
  }

  /**
   * Set the number of results to return
   */
  withSize(size: number): this {
    this.query.size = size;
    return this;
  }

  /**
   * Add a nested KNN query
   * @param path - Nested path (e.g., 'service', 'taxonomies', 'organization')
   * @param field - Field containing the embedding (e.g., 'service.embedding')
   * @param vector - Query embedding vector
   * @param k - Number of nearest neighbors
   */
  withNestedKnn(
    path: string,
    field: string,
    vector: number[],
    k: number,
  ): this {
    this.query.query = {
      function_score: {
        query: {
          nested: {
            path,
            query: {
              knn: {
                [field]: {
                  vector,
                  k,
                },
              },
            },
            score_mode: 'max',
          },
        },
        functions: this.functions,
        score_mode: 'multiply',
        boost_mode: 'replace',
      },
    };
    return this;
  }

  /**
   * Add a multi_match query for keyword search
   * @param queryText - Text to search for
   * @param fields - Fields to search across
   * @param operator - Match operator ('and' or 'or')
   */
  withMultiMatch(
    queryText: string,
    fields: string[],
    operator: 'and' | 'or' = 'and',
  ): this {
    this.query.query = {
      function_score: {
        query: {
          bool: {
            must: [
              {
                multi_match: {
                  query: queryText,
                  fields,
                  type: 'best_fields',
                  operator,
                },
              },
            ],
          },
        },
        functions: this.functions,
        score_mode: 'multiply',
        boost_mode: 'replace',
      },
    };
    return this;
  }

  /**
   * Add a nested terms query for taxonomy matching
   * @param taxonomyCodes - Array of taxonomy codes to match
   */
  withTaxonomyTerms(taxonomyCodes: string[]): this {
    this.query.query = {
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
                  score_mode: 'max',
                },
              },
            ],
          },
        },
        functions: this.functions,
        score_mode: 'multiply',
        boost_mode: 'replace',
      },
    };
    return this;
  }

  /**
   * Add a match_all query
   */
  withMatchAll(): this {
    this.query.query = {
      function_score: {
        query: {
          match_all: {},
        },
        functions: this.functions,
        score_mode: 'multiply',
        boost_mode: 'replace',
      },
    };
    return this;
  }

  /**
   * Add filters to the query
   * @param filters - Array of OpenSearch filters
   */
  withFilters(filters: any[]): this {
    if (filters.length > 0 && this.query.query?.function_score) {
      const currentQuery = this.query.query.function_score.query;
      this.query.query.function_score.query = {
        bool: {
          must: [currentQuery],
          filter: filters,
        },
      };
    }
    return this;
  }

  /**
   * Add geospatial scoring function
   * @param searchRequest - Search request with lat/lon
   */
  withGeospatialScoring(searchRequest: SearchRequestDto): this {
    if (searchRequest.lat && searchRequest.lon) {
      const weights = this.weightResolver.resolve(searchRequest);
      this.functions.push({
        gauss: {
          'location.point': {
            origin: {
              lat: searchRequest.lat,
              lon: searchRequest.lon,
            },
            scale: `${weights.geospatial.decay_scale}mi`,
            offset: `${weights.geospatial.decay_offset}mi`,
            decay: 0.5,
          },
        },
      });

      // Update functions array in query if it exists
      if (this.query.query?.function_score) {
        this.query.query.function_score.functions = this.functions;
      }
    }
    return this;
  }

  /**
   * Add pagination (cursor-based or offset-based)
   * @param searchAfter - Cursor for cursor-based pagination
   * @param offset - Offset for offset-based pagination
   * @param useOffset - Whether to use offset-based pagination
   */
  withPagination(
    searchAfter?: any[],
    offset?: number,
    useOffset = false,
  ): this {
    if (useOffset && offset !== undefined) {
      this.query.from = offset;
    } else if (searchAfter && searchAfter.length > 0) {
      this.query.search_after = searchAfter;
    }
    return this;
  }

  /**
   * Set the weight (boost) for this query
   * @param weight - Weight multiplier
   */
  withWeight(weight: number): this {
    if (this.query.query?.function_score) {
      this.query.query.function_score.boost = weight;
    }
    return this;
  }

  /**
   * Set custom sort order
   * @param sort - Array of sort specifications
   */
  withSort(sort: any[]): this {
    this.query.sort = sort;
    return this;
  }

  /**
   * Build and return the final query object
   * @returns OpenSearch query object
   */
  build(): any {
    return this.query;
  }
}
