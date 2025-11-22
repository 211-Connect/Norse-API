import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { SearchQueryDto } from './dto/search-query.dto';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { TaxonomyTermsQueryDto } from './dto/taxonomy-terms-query.dto';
import { NlpUtilsService } from 'src/common/services/nlp-utils.service';
import { AiUtilsService } from 'src/common/services/ai-utils.service';
import { SearchStrategy } from './strategies/search-strategy.interface';
import { V1SearchStrategy } from './strategies/v1-search.strategy';
import { V2SearchStrategy } from './strategies/v2-search.strategy';
import {
  SearchContext,
  ProcessedQuery,
  SearchFeature,
} from './types/search-context.interface';

@Injectable()
export class SuggestionService {
  private readonly logger = new Logger(SuggestionService.name);
  private readonly strategies: Map<string, SearchStrategy>;

  constructor(
    private readonly elasticsearchService: ElasticsearchService,
    private readonly nlpUtilsService: NlpUtilsService,
    private readonly aiUtilsService: AiUtilsService,
  ) {
    // Initialize strategies
    this.strategies = new Map([
      ['1', new V1SearchStrategy()],
      ['2', new V2SearchStrategy()],
    ]);
  }

  async searchTaxonomies(
    options: {
      headers: HeadersDto;
      query: SearchQueryDto;
    },
    version: '1' | '2' = '1',
  ) {
    try {
      const q = options.query;

      // Validate input
      if (!q.query && !q.code) {
        throw { message: 'Query or code is required' };
      }

      // Get strategy for version
      const strategy = this.strategies.get(version);
      if (!strategy) {
        throw new Error(`Unknown version: ${version}`);
      }

      // Initialize context
      const context: SearchContext = {
        originalQuery: q.query || q.code || '',
        headers: options.headers,
        version,
        skip: (q.page - 1) * 10,
        disableIntentClassification: q.disable_intent_classification,
        isCodeSearch: false,
        fields: [],
        processedQueries: [],
        features: strategy.getEnabledFeatures(),
      };

      // Build and execute pipeline
      const pipeline = strategy.buildPipeline(
        this.nlpUtilsService,
        this.aiUtilsService,
      );
      const enhancedContext = await pipeline.handle(context);

      // Execute searches
      const results = await this.executeSearches(enhancedContext);

      // Combine results
      const combinedResults = this.combineResults(enhancedContext, results);

      // Add metadata
      return this.addMetadata(enhancedContext, combinedResults);
    } catch (err) {
      throw new BadRequestException(err.message);
    }
  }

  private async executeSearches(context: SearchContext): Promise<any[]> {
    const searchPromises = context.processedQueries.map((pq) =>
      this.executeQuery(context, pq),
    );

    return Promise.all(searchPromises);
  }

  private async executeQuery(
    context: SearchContext,
    processedQuery: ProcessedQuery,
  ): Promise<any> {
    const queryBuilder = {
      index: `${context.headers['x-tenant-id']}-taxonomies_v2_${context.headers['accept-language']}`,
      from: context.skip,
      size: 10,
      query: {
        bool: {
          must: {
            multi_match: {
              query: processedQuery.query,
              type: context.version === '1' ? 'bool_prefix' : 'best_fields',
              fields: context.fields,
              fuzziness: context.features.has(SearchFeature.FUZZY_MATCHING)
                ? 'AUTO'
                : '0',
            },
          },
          filter: [],
        },
      },
      aggs: {},
    };

    return this.elasticsearchService.search(queryBuilder);
  }

  private combineResults(context: SearchContext, results: any[]): any {
    if (results.length === 0) {
      // Return empty result set
      return {
        took: 0,
        timed_out: false,
        _shards: { total: 0, successful: 0, skipped: 0, failed: 0 },
        hits: {
          total: { value: 0, relation: 'eq' },
          max_score: null,
          hits: [],
        },
      };
    }

    if (results.length === 1) {
      // Single query, return as-is
      return results[0];
    }

    // Multiple queries - combine and deduplicate
    const hitMap = new Map<string, any>();

    for (const result of results) {
      for (const hit of result.hits?.hits || []) {
        const existing = hitMap.get(hit._id);
        if (!existing || hit._score > existing._score) {
          hitMap.set(hit._id, hit);
        }
      }
    }

    // Convert map back to array and sort by score
    const combinedHits = Array.from(hitMap.values()).sort(
      (a, b) => b._score - a._score,
    );

    // Calculate total took time from all queries
    const totalTook = results.reduce((sum, r) => sum + (r.took || 0), 0);

    // Return combined result in Elasticsearch response format
    return {
      took: totalTook,
      timed_out: results.some((r) => r.timed_out),
      _shards: results[0]._shards,
      hits: {
        total: {
          value: combinedHits.length,
          relation: 'eq',
        },
        max_score: combinedHits[0]?._score || null,
        hits: combinedHits,
      },
    };
  }

  private addMetadata(context: SearchContext, results: any): any {
    // Add metadata for V2 with intent classification
    if (context.version === '2' && context.intentClassification) {
      const userQuery = context.processedQueries.find((q) => q.type === 'user');
      const intentQueries = context.processedQueries.filter(
        (q) => q.type === 'intent',
      );

      return {
        ...results,
        intent_classification: context.intentClassification,
        search_queries_used: {
          user_query_stemmed: userQuery?.query || null,
          intent_queries_stemmed: intentQueries.map((q) => q.query),
        },
      };
    }

    return results;
  }


  async getTaxonomyTermsForCodes(options: {
    headers: HeadersDto;
    query: TaxonomyTermsQueryDto;
  }) {
    const q = options.query;

    const queryBuilder: any = {
      index: `${options.headers['x-tenant-id']}-taxonomies_v2_${options.headers['accept-language']}`,
      query: {
        terms: {
          'code.raw': q?.terms ?? [],
        },
      },
    };

    let data;
    try {
      data = await this.elasticsearchService.search(queryBuilder);
    } catch (err) {
      console.log(err);
      data = {};
    }

    return data;
  }
}
