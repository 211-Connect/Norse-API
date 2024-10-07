import { Injectable, NotImplementedException } from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { SearchQueryDto } from './dto/search-query.dto';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { Request } from 'express';
import r from 'radash';
import { SearchRequest, Sort } from '@elastic/elasticsearch/lib/api/types';

type QueryType =
  (typeof SearchService.QUERY_TYPE)[keyof typeof SearchService.QUERY_TYPE];

@Injectable()
export class SearchService {
  constructor(private readonly elasticsearchService: ElasticsearchService) {}

  static readonly QUERY_TYPE = {
    MATCH_ALL: 'match_all',
    KEYWORD: 'keyword',
    TAXONOMY: 'taxonomy',
    MORE_LIKE_THIS: 'more_like_this',
  } as const;

  fieldsToQuery = [
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

  nestedFieldsToQuery = ['taxonomies.name', 'taxonomies.description'];

  async searchResources(options: {
    headers: HeadersDto;
    query: SearchQueryDto;
    tenant: Request['tenant'];
  }) {
    const { tenant } = options;

    const indexName = `${options.headers['x-tenant-id']}-resources_${options.headers['accept-language']}`;
    const q = options.query;
    const skip = (q.page - 1) * 25;
    const rawLimit = q.limit;
    const limit = isNaN(rawLimit) ? 25 : rawLimit;
    const aggs: any = {};
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
    const queryObject = this.getQueryObject(queryType, q.query, filters);
    const finalQuery = r.assign(baseQuery, queryObject);

    const data = await this.elasticsearchService.search(finalQuery);

    return {
      search: data,
      facets,
    };
  }

  private getQueryType(query: string | string[], queryType: string): QueryType {
    if (queryType === 'text' && query.length > 0) {
      return SearchService.QUERY_TYPE.KEYWORD;
    } else if (queryType === 'text' && query.length === 0) {
      return SearchService.QUERY_TYPE.MATCH_ALL;
    } else if (queryType === 'taxonomy') {
      return SearchService.QUERY_TYPE.TAXONOMY;
    } else if (queryType === 'more_like_this') {
      return SearchService.QUERY_TYPE.MORE_LIKE_THIS;
    } else {
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
                  fields: this.fieldsToQuery,
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
                      fields: this.nestedFieldsToQuery,
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
                  fields: this.fieldsToQuery,
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
    } else {
      throw new NotImplementedException(`Query for ${queryType} was not found`);
    }
  }

  private getFilters(facets, coords, distance) {
    const filters = [];

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
          geo_distance: {
            distance: `${distance}miles`,
            'location.point': {
              lon: coords[0],
              lat: coords[1],
            },
          },
        });
      }
    }

    return filters;
  }

  private getSort(coords) {
    const baseSort: Sort = [{ priority: 'desc' }];

    if (coords) {
      return baseSort.concat([
        {
          _geo_distance: {
            'location.point': {
              lon: coords[0],
              lat: coords[1],
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
}
