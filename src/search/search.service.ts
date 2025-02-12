import { Injectable, NotImplementedException, Logger } from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { SearchQueryDto } from './dto/search-query.dto';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { Request } from 'express';
import r from 'radash';
import {
  AggregationsAggregate,
  SearchRequest,
  Sort,
} from '@elastic/elasticsearch/lib/api/types';
import { getIndexName } from 'src/common/lib/utils';

type QueryType =
  (typeof SearchService.QUERY_TYPE)[keyof typeof SearchService.QUERY_TYPE];

type Aggregations = Record<string, any>;

type ComplexQuery = {
  OR?: any[];
  AND?: any[];
};

@Injectable()
export class SearchService {
  private readonly logger: Logger;

  constructor(private readonly elasticsearchService: ElasticsearchService) {
    this.logger = new Logger(SearchService.name);
  }

  private static readonly fieldsToQuery = [
    'name',
    'description',
    'summary',
    'service.name',
    'service.alternate_name',
    'service.description',
    'service.summary',
    'location.name',
    'location.alternate_name',
    'location.description',
    'location.summary',
    'organization.name',
    'organization.alternate_name',
    'organization.description',
    'organization.summary',
  ];

  static readonly QUERY_TYPE = {
    MATCH_ALL: 'match_all',
    KEYWORD: 'keyword',
    TAXONOMY: 'taxonomy',
    MORE_LIKE_THIS: 'more_like_this',
    ORGANIZATION: 'organization',
  } as const;

  private static readonly nestedFieldsToQuery = [
    'taxonomies.name',
    'taxonomies.description',
  ];

  // Checks whether the query is an object, and has OR or AND properties of type array.
  private isComplexQuery(query: any): query is ComplexQuery {
    try {
      if (query != null && typeof query === 'string') {
        const parsed = JSON.parse(query);
        return (
          typeof parsed === 'object' &&
          (Array.isArray(parsed.OR) || Array.isArray(parsed.AND))
        );
      }

      return (
        query != null &&
        typeof query === 'object' &&
        (Array.isArray(query.OR) || Array.isArray(query.AND))
      );
    } catch {
      return false;
    }
  }

  async searchResources(options: {
    headers: HeadersDto;
    query: SearchQueryDto;
    tenant: Request['tenant'];
  }) {
    this.logger.debug('Searching for resources');

    const { tenant, headers } = options;
    const { query } = options.query;

    const indexName = getIndexName(headers, 'resources');
    this.logger.debug(`searchResources - index name = ${indexName}`);

    const q = options.query;
    const skip = (q.page - 1) * 25;
    const rawLimit = q.limit;
    const limit = isNaN(rawLimit) ? 25 : rawLimit;
    const aggs: Aggregations = {};
    const baseFacets: { facet: string; name: string }[] = r.get(
      tenant,
      'facets',
      [],
    );

    const facets = {};
    baseFacets.forEach((data) => {
      facets[data.facet] = data.name;

      aggs[data.facet] = {
        terms: {
          field: `facets.${data.facet}.keyword`,
          size: 10,
        },
      };
    });

    const baseQuery: Partial<SearchRequest> = {
      index: indexName,
      from: skip,
      size: limit,
      _source_excludes: ['service_area'],
      sort: this.getSort(q.coords),
      aggs,
    };
    const filters = this.getFilters(q.filters, q.coords, q.distance);
    const queryType: QueryType = this.getQueryType(q.query, q.query_type);

    this.logger.debug(`query = ${query}`);
    this.logger.debug(`index name = ${indexName}`);

    // Distinguish between simple and complex queries
    let queryObject: Partial<SearchRequest>;

    if (queryType === 'taxonomy' && this.isComplexQuery(query)) {
      this.logger.debug('Using complex query logic');

      try {
        this.validateComplexQuery(query);
        queryObject = this.getComplexQueryObject(query, filters);
      } catch (error) {
        this.logger.error(`Invalid complex query: ${error.message}`);
        throw new Error(`Invalid query structure: ${error.message}`);
      }
    } else {
      this.logger.debug('Using simple query logic');
      queryObject = this.getQueryObject(queryType, query, filters);
    }

    const finalQuery = r.assign(baseQuery, queryObject);
    const data = await this.elasticsearchService.search(finalQuery);

    // Remove empty facets from the response
    for (const facet in facets) {
      const agg = r.get<AggregationsAggregate>(
        data,
        `aggregations.${facet}`,
        {},
      );

      if (
        agg &&
        typeof agg === 'object' &&
        'buckets' in agg &&
        agg.buckets instanceof Array &&
        !agg.buckets.length
      ) {
        delete data.aggregations[facet];
      }
    }

    return {
      search: data,
      facets,
    };
  }

  private getQueryType(query: string | string[], queryType: string): QueryType {
    if (queryType === 'text') {
      if (Array.isArray(query)) {
        throw new NotImplementedException(
          `Query type "text" not supported for query array`,
        );
      }

      return query.length > 0
        ? SearchService.QUERY_TYPE.KEYWORD
        : SearchService.QUERY_TYPE.MATCH_ALL;
    }

    switch (queryType) {
      case 'taxonomy':
        return SearchService.QUERY_TYPE.TAXONOMY;
      case 'organization':
        return SearchService.QUERY_TYPE.ORGANIZATION;
      case 'more_like_this':
        return SearchService.QUERY_TYPE.MORE_LIKE_THIS;
      default:
        throw new NotImplementedException(
          `Query type "${queryType}" not supported for query "${query}"`,
        );
    }
  }

  private getQueryObject(
    queryType: QueryType,
    query,
    filters,
  ): Partial<SearchRequest> {
    if (queryType === 'keyword') {
      return {
        query: {
          bool: {
            should: [
              {
                multi_match: {
                  analyzer: 'standard',
                  operator: 'AND',
                  fields: SearchService.fieldsToQuery,
                  query,
                },
              },
              {
                nested: {
                  path: 'taxonomies',
                  query: {
                    multi_match: {
                      analyzer: 'standard',
                      operator: 'AND',
                      fields: SearchService.nestedFieldsToQuery,
                      query,
                    },
                  },
                },
              },
            ],
            minimum_should_match: 1,
            filter: filters,
          },
        },
      };
    } else if (queryType === 'match_all') {
      return {
        query: {
          bool: {
            must: {
              match_all: {},
            },
            filter: filters,
          },
        },
      };
    } else if (queryType === 'taxonomy') {
      const queryForSearch =
        typeof query === 'string' ? query.split(',') : query;

      return {
        query: {
          bool: {
            must: [
              {
                nested: {
                  path: 'taxonomies',
                  query: {
                    bool: {
                      should:
                        queryForSearch instanceof Array
                          ? queryForSearch.map((el: any) => ({
                              match_phrase_prefix: {
                                'taxonomies.code': {
                                  query: el,
                                },
                              },
                            }))
                          : {
                              match_phrase_prefix: {
                                'taxonomies.code': {
                                  query: queryForSearch,
                                },
                              },
                            },
                      minimum_should_match: 1,
                    },
                  },
                },
              },
            ],
            filter: filters,
          },
        },
      };
    } else if (queryType === 'more_like_this') {
      return {
        query: {
          bool: {
            must: [
              {
                more_like_this: {
                  fields: SearchService.fieldsToQuery,
                  like: query,
                  min_term_freq: 1,
                  max_query_terms: 12,
                },
              },
            ],
            filter: filters,
          },
        },
      };
    } else if (queryType === 'organization') {
      return {
        query: {
          bool: {
            must: {
              term: {
                'organization.name': {
                  value: query,
                },
              },
            },
            filter: filters,
          },
        },
      };
    } else {
      throw new NotImplementedException(`Query for ${queryType} was not found`);
    }
  }

  private getFilters(facets, coords, distance) {
    const filters: any[] = [];

    for (const key in facets) {
      if (facets[key] instanceof Array) {
        for (const item of facets[key]) {
          filters.push({
            term: {
              [`facets.${key}.keyword`]: item,
            },
          });
        }
      } else {
        filters.push({
          term: {
            [`facets.${key}.keyword`]: facets[key],
          },
        });
      }
    }

    if (coords) {
      filters.push({
        geo_shape: {
          service_area: {
            shape: {
              type: 'point',
              coordinates: [coords[0], coords[1]],
            },
            relation: 'intersects',
          },
        },
      });

      if (distance > 0) {
        filters.push({
          bool: {
            should: [
              {
                bool: {
                  must: [
                    {
                      exists: {
                        field: 'location.point',
                      },
                    },
                    {
                      geo_distance: {
                        distance: `${distance}miles`,
                        'location.point': {
                          lon: coords[0],
                          lat: coords[1],
                        },
                      },
                    },
                  ],
                },
              },
              {
                bool: {
                  must_not: {
                    exists: {
                      field: 'location.point',
                    },
                  },
                },
              },
            ],
          },
        });
      }
    }

    return filters;
  }

  private getSort(coords) {
    const baseSort: Sort = [{ priority: 'desc' }];

    if (coords) {
      const [lon, lat] = coords;

      return baseSort.concat([
        {
          _geo_distance: {
            'location.point': {
              lon,
              lat,
            },
            order: 'asc',
            unit: 'm',
            mode: 'min',
          },
        },
      ]);
    }

    return baseSort;
  }

  // Helper method to validate complex queries before processing
  private validateComplexQuery(query: any): void {
    const validateNode = (node: any, depth = 1) => {
      if (depth > 5) {
        throw new Error(
          'Query nesting depth exceeds maximum allowed (5 levels)',
        );
      }

      if (typeof node === 'string') {
        if (!node.trim()) {
          throw new Error('Empty string expressions are not allowed');
        }
        return;
      }

      if (node.OR?.length === 1 || node.AND?.length === 1) {
        throw new Error('OR/AND operations must have at least 2 operands');
      }

      if (node.OR) {
        node.OR.forEach((item) => validateNode(item, depth + 1));
      }

      if (node.AND) {
        node.AND.forEach((item) => validateNode(item, depth + 1));
      }
    };

    validateNode(query);
  }

  private getComplexQueryObject(
    query: ComplexQuery,
    filters: any[],
  ): Partial<SearchRequest> {
    // Parse the query if it's a string
    const parsedQuery = typeof query === 'string' ? JSON.parse(query) : query;

    const buildTermQuery = (code: string) => ({
      nested: {
        path: 'taxonomies',
        query: {
          term: {
            'taxonomies.code.raw': code,
          },
        },
      },
    });

    const processBoolQuery = (expression: any): any => {
      // Handle OR conditions
      if (Array.isArray(expression.OR)) {
        return {
          bool: {
            should: expression.OR.map((item) => {
              if (typeof item === 'string') {
                return buildTermQuery(item);
              }
              return processBoolQuery(item);
            }),
            minimum_should_match: 1,
          },
        };
      }

      // Handle AND conditions
      if (Array.isArray(expression.AND)) {
        return {
          bool: {
            must: expression.AND.map((item) => {
              if (typeof item === 'string') {
                return buildTermQuery(item);
              }
              return processBoolQuery(item);
            }),
          },
        };
      }

      // Handle single string
      if (typeof expression === 'string') {
        return buildTermQuery(expression);
      }

      throw new Error(`Invalid query structure: ${JSON.stringify(expression)}`);
    };

    return {
      query: {
        bool: {
          must: processBoolQuery(parsedQuery),
          filter: filters,
        },
      },
    };
  }
}
