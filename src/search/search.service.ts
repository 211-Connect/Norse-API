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
  AggregationsAggregationContainer,
  AggregationsStringTermsAggregate,
  AggregationsStringTermsBucketKeys,
  QueryDslQueryContainer,
  SearchRequest,
} from '@elastic/elasticsearch/lib/api/types';
import { getIndexName } from 'src/common/lib/utils';
import { SearchResponse, SearchSource } from './dto/search-response.dto';
import { TenantConfigService } from 'src/cms-config/tenant-config.service';
import { OrchestrationConfigService } from 'src/cms-config/orchestration-config.service';
import { SearchUtilsService } from './search-utils.service';
import { HybridSearchService } from './hybrid-search.service';

type QueryType =
  (typeof SearchService.QUERY_TYPE)[keyof typeof SearchService.QUERY_TYPE];

type Aggregations = Record<string, AggregationsAggregationContainer>;

interface ComplexQuery {
  OR?: (string | ComplexQuery)[];
  AND?: (string | ComplexQuery)[];
}

interface ResourceDocument {
  facets?: Record<string, string | string[]>;
  facets_en?: Record<string, string | string[]>;
}

const FACETS_LIMIT = 100;

@Injectable()
export class SearchService {
  private readonly logger: Logger;

  private static readonly ES_FIELDS = {
    TAXONOMY_RAW: 'taxonomies.code.raw',
    ORG_NAME: 'organization.name',
    ORG_NAME_KEYWORD: 'organization.name.keyword',
    FACETS_PREFIX: 'facets.',
    FACETS_EN_PREFIX: 'facets_en.',
    TAXONOMY_NAMES_PREFIX: 'taxonomy_names.',
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
    } = q;
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

    const [tenantFacets, customAttributes] = await Promise.all([
      this.tenantConfigService.getFacets(tenantId),
      this.orchestrationConfigService
        .getCustomAttributesByTenantId(tenantId)
        // if an error occurs, just skip custom attributes
        // error is logged in OrchestrationConfigService
        .catch(() => []),
    ]);

    const searchableCustomAttributeFields = customAttributes
      .filter((attr) => attr.searchable === true)
      .flatMap((attr) => [
        `attribute_values.${attr.source_column}.value`,
        `attribute_values.${attr.source_column}.label`,
      ]);

    this.logger.debug(
      `Found ${searchableCustomAttributeFields.length} searchable custom attribute fields`,
    );

    const aggregations = this.buildFacetAggregations(tenantFacets, locale);

    const queryFilters = SearchUtilsService.buildFilters(
      filters,
      coords,
      distance,
      geo_type,
      geometry,
    );

    const queryType: QueryType = this.getQueryType(
      query as string | string[],
      query_type,
    );

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
        query,
        queryFilters,
        searchableCustomAttributeFields,
      );
    }

    const finalQuery: SearchRequest = {
      index: indexName,
      from: (page - 1) * 25,
      size: limit || 25,
      _source_excludes: ['service_area'],
      sort: SearchUtilsService.buildSort(coords),
      aggs: aggregations,
      ...specificQuery,
    };

    const data =
      await this.elasticsearchService.search<SearchSource>(finalQuery);

    if (data.hits?.hits) {
      data.hits.hits = data.hits.hits.map((hit) => {
        if (hit._source) {
          const src = hit._source as unknown as ResourceDocument;
          const normalizedFacets = this.normalizeDocFacets(src, locale);
          (hit._source as unknown as Record<string, unknown>).facets =
            normalizedFacets;
        }
        return hit;
      });
    }

    const transformedAggregations: Record<
      string,
      Record<string, string[]>
    > = {};
    const transformedFacetLabels: Record<string, Record<string, string>> = {};

    const getLabelFromAgg = (aggName: string, fallback: string): string => {
      const agg = data.aggregations?.[
        aggName
      ] as AggregationsStringTermsAggregate;
      const bucket = Array.isArray(agg?.buckets) ? agg.buckets[0] : null;
      return bucket?.key ? String(bucket.key) : fallback;
    };

    for (const f of tenantFacets) {
      const key = f.facet;
      const configNameEn = f.name;

      const labelEn = getLabelFromAgg(`label_${key}_en`, configNameEn);
      let labelLocale = labelEn;

      if (locale !== 'en') {
        labelLocale = getLabelFromAgg(`label_${key}_${locale}`, labelEn);
      }

      transformedFacetLabels[key] = {
        en: labelEn,
        [locale]: labelLocale,
      };

      const getKeys = (aggName: string): string[] => {
        const agg = data.aggregations?.[aggName] as
          | AggregationsStringTermsAggregate
          | undefined;
        const buckets = agg?.buckets;
        if (!buckets) return [];
        if (Array.isArray(buckets)) {
          return buckets.map((b) => String(b.key));
        }
        return Object.values(
          buckets as Record<string, AggregationsStringTermsBucketKeys>,
        ).map((b) => String(b.key));
      };

      const aggPayload: Record<string, string[]> = {};

      if (locale === 'en') {
        const enValues = getKeys(key);
        if (enValues.length > 0) aggPayload.en = enValues;
      } else {
        const localeValues = getKeys(key);
        const enValues = getKeys(`${key}_en`);

        if (localeValues.length > 0 || enValues.length > 0) {
          aggPayload.en = enValues;
          aggPayload[locale] = localeValues;
        }
      }

      if (Object.keys(aggPayload).length > 0) {
        transformedAggregations[key] = aggPayload;
      }
    }

    return {
      search: data,
      facets: transformedFacetLabels,
      facets_values: transformedAggregations,
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
    query: string | string[],
    filters: QueryDslQueryContainer[],
    customAttributeFields: string[],
  ): Partial<SearchRequest> {
    const baseBool = { filter: filters };
    const fieldsWithCustomAttributes = [
      ...SearchService.fieldsToQuery,
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
                    query: query as string,
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

  private buildFacetAggregations(
    tenantFacets: { facet: string; name: string }[],
    locale: string,
  ): Aggregations {
    const aggregations: Aggregations = {};

    tenantFacets.forEach((f) => {
      const key = f.facet;

      aggregations[key] = {
        terms: {
          field: `${SearchService.ES_FIELDS.FACETS_PREFIX}${key}.keyword`,
          size: FACETS_LIMIT,
        },
      };

      if (locale !== 'en') {
        aggregations[`${key}_en`] = {
          terms: {
            field: `${SearchService.ES_FIELDS.FACETS_EN_PREFIX}${key}.keyword`,
            size: FACETS_LIMIT,
          },
        };
      }

      const labelFieldBase = `${SearchService.ES_FIELDS.TAXONOMY_NAMES_PREFIX}${key}`;

      aggregations[`label_${key}_en`] = {
        terms: {
          field: `${labelFieldBase}.en.keyword`,
          size: 1,
        },
      };

      if (locale !== 'en') {
        aggregations[`label_${key}_${locale}`] = {
          terms: {
            field: `${labelFieldBase}.${locale}.keyword`,
            size: 1,
          },
        };
      }
    });

    return aggregations;
  }

  private normalizeDocFacets(
    source: ResourceDocument,
    locale: string,
  ): Record<string, Record<string, string[]>> {
    const localized = source?.facets || {};
    const en = source?.facets_en || {};

    const keys = new Set<string>([
      ...Object.keys(localized || {}),
      ...Object.keys(en || {}),
    ]);

    const out: Record<string, Record<string, string[]>> = {};

    keys.forEach((k) => {
      const locVal = localized[k];
      const enVal = en[k];

      const toArray = (v: string | string[] | null | undefined): string[] => {
        if (v == null) return [];
        return Array.isArray(v) ? v.map(String) : [String(v)];
      };

      if (locale === 'en') {
        const vals = locVal ? toArray(locVal) : enVal ? toArray(enVal) : [];

        if (vals.length > 0) {
          out[k] = { en: vals };
        }
      } else {
        const entry: Record<string, string[]> = {};

        if (enVal) {
          const arr = toArray(enVal);
          if (arr.length > 0) entry.en = arr;
        }
        if (locVal) {
          const arr = toArray(locVal);
          if (arr.length > 0) entry[locale] = arr;
        }

        if (Object.keys(entry).length > 0) {
          out[k] = entry;
        }
      }
    });

    return out;
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
}
