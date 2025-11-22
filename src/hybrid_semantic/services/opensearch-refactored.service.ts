import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@opensearch-project/opensearch';
import { SearchRequestDto } from '../dto/search-request.dto';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { getTenantShortCode } from 'src/common/config/tenant-mapping.config';
import {
  OpenSearchProfiler,
  OpenSearchCallProfile,
} from 'src/common/profiling/opensearch-profiler';
import { StrategyExecutorService } from './strategy-executor.service';
import { FilterFactory } from '../builders/filter.factory';
import { SearchContext, KeywordVariations } from '../strategies/search-strategy.interface';
import { NlpUtilsService } from 'src/common/services/nlp-utils.service';
import * as nlp from 'wink-nlp-utils';

/**
 * Refactored OpenSearch service
 * Focuses on client management and query execution
 * Query building delegated to strategies via StrategyExecutorService
 */
@Injectable()
export class OpenSearchServiceRefactored {
  private readonly logger = new Logger(OpenSearchServiceRefactored.name);
  private readonly client: Client;

  constructor(
    private readonly configService: ConfigService,
    private readonly strategyExecutor: StrategyExecutorService,
    private readonly filterFactory: FilterFactory,
    private readonly nlpUtilsService: NlpUtilsService,
  ) {
    const node =
      this.configService.get<string>('OPENSEARCH_NODE') ||
      'http://localhost:9200';
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
    });
    this.logger.log(
      `OpenSearch client initialized with node: ${node} (env: ${nodeEnv})`,
    );
  }

  /**
   * Get the OpenSearch index name based on tenant and locale
   * Format: {tenant-short-code}-resources_{locale}
   */
  getIndexName(tenant: string, locale: string): string {
    return `${tenant}-resources_${locale}`;
  }

  /**
   * Execute hybrid semantic search using _msearch
   * Delegates query building to strategies
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
      opensearch_call: OpenSearchCallProfile;
    };
  }> {
    // Map tenant name to short code
    const tenantShortCode = getTenantShortCode(tenant);
    const indexName = this.getIndexName(tenantShortCode, searchRequest.lang);
    this.logger.debug(`Executing hybrid search on index: ${indexName}`);

    const phaseStart = Date.now();
    const buildStart = Date.now();

    // Build filters
    const filters = this.filterFactory.buildAllFilters(searchRequest);

    // Generate keyword variations if we have a query
    // Uses shared NlpUtilsService to avoid duplication
    let keywordVariations: KeywordVariations | undefined;
    if (searchRequest.q && !searchRequest.disable_intent_classification) {
      const expandedQuery = this.nlpUtilsService.expandContractions(searchRequest.q);
      const rawNouns = this.nlpUtilsService.extractNouns(expandedQuery);
      
      // Expand to singular and plural forms
      const allNouns = rawNouns.flatMap((noun) =>
        this.nlpUtilsService.getSingularAndPluralForms(noun),
      );
      
      // Filter generic nouns and deduplicate
      const nounsSet = new Set(
        allNouns.filter((noun) => !this.nlpUtilsService.isGenericNoun(noun)),
      );
      const nouns = Array.from(nounsSet);
      
      // Stem and deduplicate
      const stemmedNounsSet = new Set(this.nlpUtilsService.stemWords(nouns));
      const stemmedNouns = Array.from(stemmedNounsSet);
      
      // Get synonyms
      const synonymPromises = nouns.map((noun) =>
        this.nlpUtilsService.getSynonyms(noun),
      );
      const synonymsArrays = await Promise.all(synonymPromises);
      const synonymsSet = new Set(synonymsArrays.flat());
      const synonyms = Array.from(synonymsSet).filter(
        (syn) => !stemmedNounsSet.has(syn),
      );
      
      // Extract topics
      const topics = this.nlpUtilsService.extractTopics(expandedQuery);
      
      keywordVariations = {
        original: expandedQuery,
        nouns,
        stemmedNouns,
        synonyms,
        topics,
      };
      
      this.logger.debug(
        `Keyword variations - Original: "${expandedQuery}", Nouns: [${nouns.join(', ')}], Stemmed: [${stemmedNouns.join(', ')}], Synonyms: [${synonyms.join(', ')}], Topics: [${topics.join(', ')}]`,
      );
    }

    // Determine pagination parameters
    const useOffsetPagination = searchRequest.legacy_offset_pagination;
    const offset = useOffsetPagination
      ? (searchRequest.page - 1) * searchRequest.limit
      : undefined;

    // Build search context
    const context: SearchContext = {
      embedding: queryEmbedding,
      searchRequest,
      filters,
      k: 50, // Candidates per strategy
      searchAfter: searchRequest.search_after,
      useOffsetPagination,
      offset,
      intentClassification,
      keywordVariations,
    };

    // Use strategy executor to build msearch body
    const { body: msearchBody, strategyNames } =
      this.strategyExecutor.buildMsearchBody(context, indexName);

    const requestBuildTime = Date.now() - buildStart;

    try {
      // Initialize profiler for detailed timing breakdown
      const profiler = new OpenSearchProfiler();
      profiler.startMsearch();

      // Execute multi-search with detailed profiling
      profiler.startHttpRoundTrip();
      const response = await this.client.msearch({
        body: msearchBody,
      });
      profiler.startDeserialization();

      // Complete profiling and get detailed breakdown
      const opensearchCallProfile = profiler.completeProfile(
        response,
        strategyNames,
      );

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
          opensearch_call: opensearchCallProfile,
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
}
