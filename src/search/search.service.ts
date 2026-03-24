import {
  Injectable,
  NotImplementedException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchBodyDto } from './dto/search-body.dto';
import { HeadersDto } from '../common/dto/headers.dto';
import {
  AggregationsStringTermsAggregate,
  QueryDslQueryContainer,
  SearchRequest,
} from '@elastic/elasticsearch/lib/api/types';
import { getIndexName } from 'src/common/lib/utils';
import { SearchResponse, SearchSource } from './dto/search-response.dto';
import { TenantConfigService } from 'src/cms-config/tenant-config.service';
import { OrchestrationConfigService } from 'src/cms-config/orchestration-config.service';
import { SearchUtilsService } from './search-utils.service';
import { HybridSearchService } from './hybrid-search.service';
import { FacetConfig } from 'src/cms-config/types/facet-config';
import { CustomAttribute } from 'src/cms-config/types/custom-attribute';

type QueryType =
  (typeof SearchService.QUERY_TYPE)[keyof typeof SearchService.QUERY_TYPE];

interface ComplexQuery {
  OR?: (string | ComplexQuery)[];
  AND?: (string | ComplexQuery)[];
}

@Injectable()
export class SearchService {
  private readonly logger: Logger;

  private static readonly ES_FIELDS = {
    TAXONOMY_RAW: 'taxonomies.code.raw',
    ORG_NAME: 'organization.name',
    ORG_NAME_KEYWORD: 'organization.name.keyword',
  };

  constructor(
    private readonly elasticsearchService: ElasticsearchService,
    private readonly tenantConfigService: TenantConfigService,
    private readonly orchestrationConfigService: OrchestrationConfigService,
    private readonly hybridSearchService: HybridSearchService,
  ) {
    this.logger = new Logger(SearchService.name);
  }

  static readonly QUERY_TYPE = {
    MATCH_ALL: 'match_all',
    KEYWORD: 'keyword',
    TAXONOMY: 'taxonomy',
    MORE_LIKE_THIS: 'more_like_this',
    ORGANIZATION: 'organization',
    HYBRID: 'hybrid',
  } as const;

  private isComplexQuery(query: unknown): query is ComplexQuery {
    try {
      if (query != null && typeof query === 'string') {
        const parsed = JSON.parse(query);
        return (
          typeof parsed === 'object' &&
          (Array.isArray(parsed.OR) || Array.isArray(parsed.AND))
        );
      }

      const obj = query as Record<string, unknown>;
      return (
        query != null &&
        typeof query === 'object' &&
        (Array.isArray(obj.OR) || Array.isArray(obj.AND))
      );
    } catch {
      return false;
    }
  }

  async searchResources(options: {
    headers: HeadersDto;
    query: SearchQueryDto;
    body?: SearchBodyDto;
  }): Promise<SearchResponse> {
    this.logger.debug('Searching for resources');

    const { headers, query: q } = options;
    const {
      query,
      query_type,
      page,
      limit,
      filters,
      coords,
      distance,
      geo_type,
      sort,
    } = q;

    if (
      !(
        typeof query === 'string' ||
        (Array.isArray(query) && query.every((q) => typeof q === 'string'))
      )
    ) {
      throw new BadRequestException('Invalid query type');
    }

    const { geometry } = options.body || {};
    const tenantId = headers['x-tenant-id'];

    if (query_type === 'hybrid') {
      return this.hybridSearchService.searchHybrid(options);
    }

    const indexName = getIndexName(headers, 'resources');

    const locale = headers['accept-language'] || 'en';

    this.logger.debug(
      `searchResources - index name = ${indexName}, locale = ${locale}`,
    );

    const { tenantFacets, customAttributes } =
      await this.getFacetsAndCustomAttributes(tenantId);

    const searchableCustomAttributeFields = customAttributes
      .filter((attr) => attr.searchable === true)
      .flatMap((attr) => [
        `attribute_values.${attr.source_column}.value`,
        `attribute_values.${attr.source_column}.label`,
      ]);

    this.logger.debug(
      `Found ${searchableCustomAttributeFields.length / 2} searchable custom attribute fields`,
    );

    const aggregations = SearchUtilsService.buildFacetAggregations(
      tenantFacets,
      locale,
    );

    this.logger.debug(
      `Built ${Object.keys(aggregations).length} aggregations from ${tenantFacets.length} facet configs`,
    );

    const queryFilters = SearchUtilsService.buildFilters(
      filters,
      coords,
      distance,
      geo_type,
      geometry,
    );

    const queryType: QueryType = this.getQueryType(query, query_type);

    let parsedComplexQuery = null;
    if (this.isComplexQuery(query)) {
      parsedComplexQuery =
        typeof query === 'string' ? JSON.parse(query) : query;
    }

    let specificQuery: Partial<SearchRequest>;

    if (queryType === 'taxonomy' && parsedComplexQuery) {
      this.logger.debug('Using complex query logic');

      try {
        this.validateComplexQuery(parsedComplexQuery);
        specificQuery = this.getComplexQueryObject(
          parsedComplexQuery,
          queryFilters,
        );
      } catch (error) {
        throw new BadRequestException(
          `Invalid query structure: ${error.message}`,
        );
      }
    } else {
      this.logger.debug('Using simple query logic');
      specificQuery = this.getQueryObject(
        queryType,
        Array.isArray(query) ? query.join(',') : query,
        queryFilters,
        searchableCustomAttributeFields,
      );
    }

    const finalQuery: SearchRequest = {
      index: indexName,
      from: (page - 1) * 25,
      size: limit || 25,
      _source_excludes: ['service_area'],
      sort: SearchUtilsService.buildSort(coords, sort),
      aggs: aggregations,
      ...specificQuery,
    };

    const data = await this.elasticsearchService.search<
      SearchSource,
      Record<string, AggregationsStringTermsAggregate>
    >(finalQuery);

    if (data.hits?.hits) {
      data.hits.hits = data.hits.hits.map((hit) => {
        if (hit._source) {
          const normalizedFacets = SearchUtilsService.normalizeDocFacets(
            hit._source,
            locale,
          );
          hit._source = { ...hit._source, facets: normalizedFacets };
        }
        return hit;
      });
    }

    const facets = SearchUtilsService.transformAggregations(
      tenantFacets,
      data.aggregations,
      locale,
    );

    const totalHits =
      typeof data.hits.total === 'number'
        ? data.hits.total
        : (data.hits.total?.value ?? 0);

    this.logger.debug(
      `Search completed: ${totalHits} results, ${facets.length} facets`,
    );

    return {
      search: {
        took: data.took,
        timed_out: data.timed_out,
        _shards: {
          total: data._shards.total,
          successful: data._shards.successful,
          skipped: data._shards.skipped ?? 0,
          failed: data._shards.failed,
        },
        hits: data.hits,
      },
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
      case 'hybrid':
        return SearchService.QUERY_TYPE.HYBRID;
      default:
        this.logger.warn(
          `Rejected invalid query_type (possible injection attempt): ${queryType}`,
        );
        throw new BadRequestException('Invalid query type specified');
    }
  }

  private getQueryObject(
    queryType: QueryType,
    query: string,
    filters: QueryDslQueryContainer[],
    customAttributeFields: string[],
  ): Partial<SearchRequest> {
    const baseBool = { filter: filters };
    const fieldsWithCustomAttributes = [
      ...SearchUtilsService.FIELDS_TO_QUERY,
      ...customAttributeFields,
    ];

    switch (queryType) {
      case 'keyword':
        return {
          query: {
            bool: {
              ...baseBool,
              should: [
                {
                  multi_match: {
                    analyzer: 'standard',
                    operator: 'AND',
                    fields: fieldsWithCustomAttributes,
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
                        fields: SearchUtilsService.NESTED_FIELDS_TO_QUERY,
                        query,
                      },
                    },
                  },
                },
              ],
              minimum_should_match: 1,
            },
          },
        };

      case 'organization':
        return {
          query: {
            bool: {
              ...baseBool,
              must: {
                match: {
                  [SearchService.ES_FIELDS.ORG_NAME]: {
                    query,
                    operator: 'AND',
                  },
                },
              },
            },
          },
        };

      case 'taxonomy':
        const queryForSearch = Array.isArray(query)
          ? query
          : typeof query === 'string'
            ? query.split(',')
            : [query];
        return {
          query: {
            bool: {
              ...baseBool,
              must: [
                {
                  nested: {
                    path: 'taxonomies',
                    query: {
                      bool: {
                        should: queryForSearch.map((el: string) => ({
                          match_phrase_prefix: {
                            'taxonomies.code': {
                              query: el,
                            },
                          },
                        })),
                        minimum_should_match: 1,
                      },
                    },
                  },
                },
              ],
            },
          },
        };

      case 'more_like_this':
        return {
          query: {
            bool: {
              must: [
                {
                  more_like_this: {
                    fields: fieldsWithCustomAttributes,
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
      case 'match_all':
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

      default:
        throw new NotImplementedException(
          `Query for "${queryType}" not implemented`,
        );
    }
  }

  private validateComplexQuery(query: ComplexQuery): void {
    const validateNode = (node: string | ComplexQuery, depth = 1) => {
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
    filters: QueryDslQueryContainer[],
  ): Partial<SearchRequest> {
    const parsedQuery = typeof query === 'string' ? JSON.parse(query) : query;

    const buildTermQuery = (code: string): QueryDslQueryContainer => ({
      nested: {
        path: 'taxonomies',
        query: {
          term: {
            'taxonomies.code.raw': code,
          },
        },
      },
    });

    const processBoolQuery = (
      expression: string | ComplexQuery,
    ): QueryDslQueryContainer => {
      if (
        typeof expression === 'object' &&
        'OR' in expression &&
        Array.isArray(expression.OR)
      ) {
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

      if (
        typeof expression === 'object' &&
        'AND' in expression &&
        Array.isArray(expression.AND)
      ) {
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

  /**
   * Fetches facets and custom attributes with a 2-second timeout.
   * Returns empty arrays if the timeout is reached.
   * It prevents the search endpoint from being blocked by slow responses from config services.
   */
  private async getFacetsAndCustomAttributes(tenantId: string): Promise<{
    tenantFacets: FacetConfig[];
    customAttributes: CustomAttribute[];
  }> {
    let timeoutId: NodeJS.Timeout;

    const timeoutPromise = new Promise<{
      tenantFacets: FacetConfig[];
      customAttributes: CustomAttribute[];
    }>((resolve) => {
      timeoutId = setTimeout(() => {
        this.logger.warn(
          `Timeout fetching facets and custom attributes for tenant ${tenantId}, using empty arrays`,
        );
        resolve({ tenantFacets: [], customAttributes: [] });
      }, 2000);
    });

    const dataPromise = Promise.all([
      this.tenantConfigService.getFacets(tenantId).catch((err) => {
        this.logger.error(`Error fetching facets for tenant ${tenantId}:`, err);
        return [];
      }),
      this.orchestrationConfigService
        .getCustomAttributesByTenantId(tenantId)
        .catch(() => {
          this.logger.error(
            `Error fetching custom attributes for tenant ${tenantId}, using empty array`,
          );
          return [];
        }),
    ]).then(([tenantFacets, customAttributes]) => {
      // Clear timeout to prevent memory leak
      clearTimeout(timeoutId);
      return { tenantFacets, customAttributes };
    });

    return Promise.race([dataPromise, timeoutPromise]);
  }
}
