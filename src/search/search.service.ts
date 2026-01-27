import {
  Injectable,
  NotImplementedException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { SearchQueryDto } from './dto/search-query.dto';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { Request } from 'express';
import {
  AggregationsStringTermsAggregate,
  SearchRequest,
  Sort,
} from '@elastic/elasticsearch/lib/api/types';
import { getIndexName } from 'src/common/lib/utils';
import { SearchResponse } from './dto/search-response.dto';

type QueryType =
  (typeof SearchService.QUERY_TYPE)[keyof typeof SearchService.QUERY_TYPE];

type Aggregations = Record<string, any>;

type ComplexQuery = {
  OR?: any[];
  AND?: any[];
};

// Interface for the source of a document in Elasticsearch
interface ResourceDocument {
  facets?: Record<string, any>;
  facets_en?: Record<string, any>;
  [key: string]: any; // Allow other properties
}

const FACETS_LIMIT = 100;

@Injectable()
export class SearchService {
  private readonly logger: Logger;

  // Define fields as constants
  private static readonly ES_FIELDS = {
    TAXONOMY_CODE: 'taxonomies.code',
    TAXONOMY_RAW: 'taxonomies.code.raw',
    ORG_NAME: 'organization.name',
    ORG_NAME_KEYWORD: 'organization.name.keyword',
    FACETS_PREFIX: 'facets.',
    FACETS_EN_PREFIX: 'facets_en.',
    TAXONOMY_NAMES_PREFIX: 'taxonomy_names.',
  };

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
  }): Promise<SearchResponse> {
    this.logger.debug('Searching for resources');

    const { tenant, headers, query: q } = options;
    const { query } = q;
    const indexName = getIndexName(headers, 'resources');

    // Determine requested locale, default to 'en'
    const locale = headers['accept-language'] || 'en';

    this.logger.debug(
      `searchResources - index name = ${indexName}, locale = ${locale}`,
    );

    // Prepare Facets (Aggregations)
    const tenantFacets = (tenant?.facets || []) as {
      facet: string;
      name: string;
    }[];

    // Build the raw Elasticsearch aggregations
    const aggregations = this.buildFacetAggregations(tenantFacets, locale);

    // Prepare Filters
    const filters = this.getFilters(q.filters, q.coords, q.distance);
    // Determine Query Logic
    const queryType = this.getQueryType(query, q.query_type);

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
        specificQuery = this.getComplexQueryObject(parsedComplexQuery, filters);
      } catch (error) {
        throw new BadRequestException(
          `Invalid query structure: ${error.message}`,
        );
      }
    } else {
      this.logger.debug('Using simple query logic');
      specificQuery = this.getQueryObject(queryType, query, filters);
    }

    const finalQuery: SearchRequest = {
      index: indexName,
      from: (q.page - 1) * 25,
      size: q.limit || 25,
      _source_excludes: ['service_area'],
      sort: this.getSort(q.coords),
      aggs: aggregations,
      ...specificQuery,
    };

    const data = await this.elasticsearchService.search(finalQuery);

    // Normalize document-level facets
    if (data.hits?.hits) {
      data.hits.hits = data.hits.hits.map((hit) => {
        if (hit._source) {
          const src = hit._source as ResourceDocument;
          src.facets = this.normalizeDocFacets(src, locale);
          hit._source = src;
        }
        return hit;
      });
    }

    // Transform Aggregations (Bottom Facets) into { en: [], es: [] } structure
    const transformedAggregations: Record<string, any> = {};
    // Transform Facet Labels into { en: "...", es: "..." }
    const transformedFacetLabels: Record<string, any> = {};

    // Helper to extract label from the new label aggregations
    const getLabelFromAgg = (aggName: string, fallback: string): string => {
      const agg = data.aggregations?.[
        aggName
      ] as AggregationsStringTermsAggregate;
      // Safely access the first bucket of the terms aggregation
      const bucket = Array.isArray(agg?.buckets) ? agg.buckets[0] : null;
      // Return the key from ES if found, otherwise fallback to config name
      return bucket?.key ? String(bucket.key) : fallback;
    };

    for (const f of tenantFacets) {
      const key = f.facet;
      const configNameEn = f.name;

      // Fetch English Label from ES 'taxonomy_names', fallback to config
      const labelEn = getLabelFromAgg(`label_${key}_en`, configNameEn);
      // Fetch Localized Label from ES 'taxonomy_names', fallback to English Label
      let labelLocale = labelEn; // Default to English if no specific locale agg needed

      if (locale !== 'en') {
        // Try to get the specific locale label from ES, fallback to English label
        labelLocale = getLabelFromAgg(`label_${key}_${locale}`, labelEn);
      }

      transformedFacetLabels[key] = {
        en: labelEn,
        [locale]: labelLocale,
      };

      // --- Handle Aggregations (Values) ---
      // Helper to extract bucket keys
      const getKeys = (aggName: string): string[] => {
        const agg = data.aggregations?.[aggName] as
          | AggregationsStringTermsAggregate
          | undefined;
        const buckets = agg?.buckets;
        if (!buckets) return [];
        if (Array.isArray(buckets)) {
          return buckets.map((b) => (b as any).key as string);
        }
        // Handle object-shaped buckets (non-array form)
        return Object.values(buckets as Record<string, any>).map(
          (b) => b.key as string,
        );
      };

      const aggPayload: any = {};

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

      // Only add to aggregations if we have data
      if (Object.keys(aggPayload).length > 0) {
        transformedAggregations[key] = aggPayload;
      }
    }

    return {
      search: data,
      facets: transformedFacetLabels, // Contains labels from taxonomy_names
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
      default:
        throw new NotImplementedException(
          `Query type "${queryType}" not supported for query "${query}"`,
        );
    }
  }

  private getQueryObject(
    queryType: QueryType,
    query: any,
    filters: any[],
  ): Partial<SearchRequest> {
    const baseBool = { filter: filters };

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
            },
          },
        };

      case 'organization':
        return {
          query: {
            bool: {
              ...baseBool,
              must: {
                // FIX: Changed from 'term' to 'match' for text fields, or use .keyword for term
                match: {
                  [SearchService.ES_FIELDS.ORG_NAME]: {
                    query: query,
                    operator: 'AND',
                  },
                },
              },
            },
          },
        };

      case 'taxonomy':
        const codes = Array.isArray(query)
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
                      terms: {
                        [SearchService.ES_FIELDS.TAXONOMY_CODE]: codes,
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

  private getFilters(
    facets: Record<string, any>,
    coords: number[],
    distance: number,
  ) {
    const filters: any[] = [];

    for (const [key, value] of Object.entries(facets || {})) {
      const field = `${SearchService.ES_FIELDS.FACETS_PREFIX}${key}.keyword`;

      if (Array.isArray(value)) {
        filters.push({ terms: { [field]: value } });
      } else {
        filters.push({ term: { [field]: value } });
      }
    }

    if (coords) {
      const [lon, lat] = coords.map(Number); // Ensure coords are numbers

      filters.push({
        geo_shape: {
          service_area: {
            shape: {
              type: 'point',
              coordinates: [lon, lat],
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

  private getSort(coords: number[]): Sort {
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

  // Build facet aggregations for tenant facets. For non-en locales also add an
  // English aggregation reading from `facets_en`.
  private buildFacetAggregations(
    tenantFacets: { facet: string; name: string }[],
    locale: string,
  ): Aggregations {
    const aggregations: Aggregations = {};

    tenantFacets.forEach((f) => {
      const key = f.facet;

      // 1. Values Aggregation (Existing logic)
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

      // 2. Labels Aggregation (New logic)
      // Fetch the label name from the document's taxonomy_names field
      // e.g., taxonomy_names.payment.en
      const labelFieldBase = `${SearchService.ES_FIELDS.TAXONOMY_NAMES_PREFIX}${key}`;

      aggregations[`label_${key}_en`] = {
        terms: {
          field: `${labelFieldBase}.en.keyword`,
          size: 1, // We only need the top (unique) label
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

  // Normalize a single document's facets into the bilingual shape.
  private normalizeDocFacets(
    source: any,
    locale: string,
  ): Record<string, string[]> | Record<string, Record<string, string[]>> {
    const localized = source?.facets || {};
    const en = source?.facets_en || {};

    const keys = new Set<string>([
      ...Object.keys(localized || {}),
      ...Object.keys(en || {}),
    ]);

    const out: Record<string, any> = {};

    keys.forEach((k) => {
      const locVal = localized[k];
      const enVal = en[k];

      // Helper to ensure array type
      const toArray = (v: any): string[] => {
        if (v == null) return [];
        return Array.isArray(v) ? v.map(String) : [String(v)];
      };

      if (locale === 'en') {
        // For English queries, return values under `en` only. Prefer localized
        // (which in an English index contains English) and fall back to facets_en.
        const vals = locVal ? toArray(locVal) : enVal ? toArray(enVal) : [];

        if (vals.length > 0) {
          out[k] = { en: vals };
        }
      } else {
        const entry: Record<string, string[]> = {};

        // Add English if exists
        if (enVal) {
          const arr = toArray(enVal);
          if (arr.length > 0) entry.en = arr;
        }
        // Add Localized if exists
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
