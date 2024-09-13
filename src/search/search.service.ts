import { Injectable } from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { SearchQueryDto } from './dto/search-query.dto';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { Request } from 'express';

@Injectable()
export class SearchService {
  constructor(private readonly elasticsearchService: ElasticsearchService) {}

  async searchResources(options: {
    headers: HeadersDto;
    query: SearchQueryDto;
    tenant: Request['tenant'];
  }) {
    const { tenant } = options;

    const q = options.query;
    const skip = (q.page - 1) * 25;
    const aggs: any = {};
    const rawLimit = q.limit;
    const limit = isNaN(rawLimit) ? 25 : rawLimit;
    const coords = q.coords;

    const fieldsToQuery = [
      'display_name',
      'service_name',
      'service_alternate_name',
      'service_description',
      'organization_name',
      'organization_alternate_name',
      'organization_description',
      'taxonomy_terms',
      'taxonomy_descriptions',
    ];

    if (tenant?.facets && tenant?.facets instanceof Array) {
      // Get facets for faceted search for specific tenant
      tenant.facets?.forEach((data) => {
        aggs[data.facet] = {
          terms: {
            field: `facets.${data.facet}.keyword`,
            size: 10,
          },
        };
      });
    }

    const queryBuilder: any = {
      index: `${options.headers['x-tenant-id']}-resources_temp_${options.headers['accept-language']}`,
      from: skip,
      size: limit,
      _source_excludes: ['service_area'],
      query: {},
      sort: [],
      aggs,
    };

    if (
      q.query_type === 'text' &&
      q.query.length > 0 &&
      typeof q.query === 'string'
    ) {
      queryBuilder.query = {
        bool: {
          must: {
            multi_match: {
              query: q.query,
              analyzer: 'standard',
              operator: 'OR',
              fields: fieldsToQuery,
            },
          },
          filter: [],
        },
      };
    } else if (q.query_type === 'text' && q.query.length === 0) {
      queryBuilder.query = {
        bool: {
          must: {
            match_all: {},
          },
          filter: [],
        },
      };
    } else if (q.query_type === 'taxonomy') {
      q.query = typeof q.query === 'string' ? q.query.split(',') : q.query;

      queryBuilder.query = {
        bool: {
          should:
            q.query instanceof Array
              ? q.query.map((el: any) => ({
                  match_phrase_prefix: {
                    taxonomy_codes: {
                      query: el,
                    },
                  },
                }))
              : {
                  match_phrase_prefix: {
                    taxonomy_codes: {
                      query: q.query,
                    },
                  },
                },
          filter: [],
          minimum_should_match: 1,
        },
      };
    } else if (q.query_type === 'more_like_this') {
      queryBuilder.query = {
        bool: {
          must: [
            {
              more_like_this: {
                fields: fieldsToQuery,
                like: q.query,
                min_term_freq: 1,
                max_query_terms: 12,
              },
            },
          ],
          filter: [],
        },
      };
    }

    const filters = [];
    for (const key in q.filters) {
      if (q.filters[key] instanceof Array) {
        for (const item of q.filters[key]) {
          filters.push({
            term: {
              [`facets.${key}.keyword`]: item,
            },
          });
        }
      } else {
        filters.push({
          term: {
            [`facets.${key}.keyword`]: q.filters[key],
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

      // Sort by distance
      queryBuilder.sort = [
        {
          _geo_distance: {
            location: {
              lon: coords[0],
              lat: coords[1],
            },
            order: 'asc',
            unit: 'm',
            mode: 'min',
          },
        },
      ];

      // If distance is greater than 0, apply geo_distance filter
      if (q.distance > 0) {
        filters.push({
          geo_distance: {
            distance: `${q.distance}miles`,
            location: {
              lon: coords[0],
              lat: coords[1],
            },
          },
        });
      }
    }

    if (queryBuilder.query?.bool?.filter) {
      queryBuilder.query.bool.filter = filters;
    }

    if (queryBuilder.sort != null) {
      // eslint-disable-next-line
      // @ts-ignore
      queryBuilder.sort = [{ priority: { order: 'desc' } }].concat(
        // eslint-disable-next-line
        // @ts-ignore
        queryBuilder.sort,
      );
    }

    const data = await this.elasticsearchService.search(queryBuilder);

    const facets: any = {};
    if (tenant?.facets && tenant?.facets instanceof Array) {
      for (const item of tenant.facets) {
        facets[item.facet] = item.name;
      }
    }

    return {
      search: data,
      facets,
    };
  }
}
