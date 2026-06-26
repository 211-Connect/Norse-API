import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import {
  AggregationsStringTermsAggregate,
  QueryDslQueryContainer,
  QueryDslFunctionScoreContainer,
  SearchRequest,
  Sort,
} from '@elastic/elasticsearch/lib/api/types';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchBodyDto } from './dto/search-body.dto';
import { HeadersDto } from '../common/dto/headers.dto';
import {
  SearchHit,
  SearchResponse,
  SearchSource,
} from './dto/search-response.dto';
import { SearchUtilsService } from './search-utils.service';
import { EmbeddingResponse, Aggregations } from './types';
import { TenantConfigService } from '../cms-config/tenant-config.service';
import { RequestCacheService } from 'src/common/services/cache/request-cache.service';
import { hybridDocumentsCountCacheKey } from './internal/cache-key/hybrid-documents-count-cache-key';

// Vector weight mirrors the old kNN boost; tune to shift lexical vs semantic balance.
const VECTOR_SCORE_WEIGHT = 50;
// Base boost for a matched predicted taxonomy code; multiplied by the code's
// prediction (kNN cosine) score and a small rank-decay factor.
const BASE_TAXONOMY_BOOST = 10;
const GEO_GAUSS_WEIGHT = 1.5;
const GEO_DEFAULT_SCALE_MI = 5;

const BM25_NAME_BOOST = 15;

const TAXONOMY_K = 5;
const TAXONOMY_NUM_CANDIDATES = 100;

interface PredictedTaxonomy {
  code: string;
  name: string;
  score: number;
}

@Injectable()
export class HybridSearchService {
  private readonly logger = new Logger(HybridSearchService.name);
  private readonly embeddingBaseUrl: string;
  private readonly embeddingModel: string;
  private readonly runpodApiKey: string;

  constructor(
    private readonly elasticsearchService: ElasticsearchService,
    private readonly configService: ConfigService,
    private readonly tenantConfigService: TenantConfigService,
    private readonly requestCacheService: RequestCacheService,
  ) {
    this.embeddingBaseUrl =
      this.configService.get<string>('EMBEDDING_BASE_URL');
    this.embeddingModel = this.configService.get<string>('EMBEDDING_MODEL');
    this.runpodApiKey = this.configService.get<string>('RUNPOD_API_KEY');
  }

  /**
   * Counts resources scoped to a set of taxonomy codes for a tenant.
   * Used by the AI search "clarify" flow to show how many resources match a
   * given need category. Scope-only semantics: tenant + taxonomy codes, no
   * free-text query and no geo filtering.
   */
  async getDocumentsCount(
    headers: HeadersDto,
    _query: string,
    taxonomies: string[],
  ): Promise<number> {
    const tenantId = headers['x-tenant-id'];
    const lang = headers['accept-language'] || 'en';
    const index = `hybrid_search_resources_${this.sanitizeLang(lang)}`;

    if (!taxonomies || taxonomies.length === 0) {
      return 0;
    }

    const filter: QueryDslQueryContainer[] = [
      { term: { tenant_id: tenantId } },
      this.buildHardTaxonomyScopeFilter(taxonomies),
    ];

    const cacheKey = hybridDocumentsCountCacheKey(tenantId, lang, taxonomies);

    return this.requestCacheService.getOrSet(cacheKey, async () => {
      try {
        const result = await this.elasticsearchService.count({
          index,
          query: { bool: { filter } },
        });
        return result.count;
      } catch (error) {
        this.logger.warn(
          `Document count failed for tenant=${tenantId}: ${error.message}`,
        );
        return 0;
      }
    });
  }

  async searchHybrid(options: {
    headers: HeadersDto;
    query: SearchQueryDto;
    body?: SearchBodyDto;
  }): Promise<SearchResponse> {
    const { headers, query: q } = options;
    const { query, page, limit, filters, coords, distance, age, geo_type } = q;
    const { geometry } = options.body || {};
    const tenantId = headers['x-tenant-id'];
    const lang = headers['accept-language'] || 'en';
    const queryStr = typeof query === 'string' ? query : String(query);
    const hardScopeCodes = q.taxonomy ?? [];

    const index = `hybrid_search_resources_${this.sanitizeLang(lang)}`;
    const t0 = performance.now();

    this.logger.debug(
      `Hybrid search — tenant=${tenantId}, index=${index}, query="${queryStr}"`,
    );

    const tEmbedStart = performance.now();
    const [queryVector, tenantFacets] = await Promise.all([
      this.embedQuery(queryStr),
      this.tenantConfigService.getFacets(tenantId),
    ]);
    const tEmbedMs = Math.round(performance.now() - tEmbedStart);

    const tTaxonomyStart = performance.now();
    const predictedTaxonomies = await this.getTaxonomyCodes(
      queryVector,
      tenantId,
    );
    const tTaxonomyMs = Math.round(performance.now() - tTaxonomyStart);

    this.logger.log(
      `[Hybrid search] - query="${queryStr}" | predicted codes: [${predictedTaxonomies
        .map((t) => t.code)
        .join(', ')}] | names: [${predictedTaxonomies
        .map((t) => t.name)
        .join(', ')}]`,
    );

    // buildFilters keeps the existing geo semantics: service_area "contains" AND
    // (within `distance` of location.point OR no location.point). A true
    // "service_area OR location-close" would require combining those into a
    // `should` with minimum_should_match: 1 — intentionally NOT changed here.
    const baseFilters = SearchUtilsService.buildFilters(
      filters,
      coords,
      distance,
      age,
      geo_type,
      geometry,
    );
    baseFilters.unshift({ term: { tenant_id: tenantId } });

    if (hardScopeCodes.length > 0) {
      baseFilters.push(this.buildHardTaxonomyScopeFilter(hardScopeCodes));
    }

    const aggs = SearchUtilsService.buildFacetAggregations(tenantFacets, lang);

    const request = this.buildHybridQuery({
      index,
      queryStr,
      queryVector,
      predicted: predictedTaxonomies,
      filters: baseFilters,
      coords,
      distance: distance ?? 0,
      page,
      limit: limit || 25,
      aggs,
    });

    const tSearchStart = performance.now();
    const data = await this.elasticsearchService.search<
      SearchSource,
      Record<string, AggregationsStringTermsAggregate>
    >(request);
    const tSearchMs = Math.round(performance.now() - tSearchStart);

    const hits: SearchHit[] = (data.hits.hits ?? []).map((hit) => {
      const normalizedFacets = SearchUtilsService.normalizeDocFacets(
        hit._source,
        lang,
      );
      return {
        _index: hit._index,
        _id: hit._id,
        _score: hit._score ?? null,
        _source: { ...hit._source, facets: normalizedFacets },
        sort: hit.sort as number[] | undefined,
      };
    });

    const facets = SearchUtilsService.transformAggregations(
      tenantFacets,
      data.aggregations,
      lang,
    );

    const totalHits =
      typeof data.hits.total === 'number'
        ? data.hits.total
        : (data.hits.total?.value ?? 0);

    const totalMs = Math.round(performance.now() - t0);
    this.logger.log(
      `[Hybrid search] timings - embedding: ${tEmbedMs}ms | taxonomy lookup: ${tTaxonomyMs}ms | search: ${tSearchMs}ms | total: ${totalMs}ms`,
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
        hits: {
          total: { value: totalHits, relation: 'eq' },
          max_score: hits[0]?._score ?? null,
          hits,
        },
      },
      facets,
    };
  }

  async embedQuery(query: string): Promise<number[]> {
    this.logger.debug(
      `Embedding query: "${query}" using model: ${this.embeddingModel}`,
    );

    if (!this.embeddingBaseUrl || !this.embeddingModel) {
      throw new InternalServerErrorException(
        'EMBEDDING_BASE_URL and EMBEDDING_MODEL must be configured for hybrid search',
      );
    }

    try {
      const response = await fetch(`${this.embeddingBaseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.runpodApiKey}`,
        },
        body: JSON.stringify({ model: this.embeddingModel, input: query }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Embedding API returned ${response.status}: ${text}`);
      }

      const data: EmbeddingResponse = await response.json();
      const embedding = data.data[0].embedding;

      this.logger.debug(`Embedding length: ${embedding.length}`);
      return embedding;
    } catch (error) {
      this.logger.error(`Failed to embed query: ${error.message}`, error.stack);
      throw new InternalServerErrorException(
        `Query embedding failed: ${error.message}`,
      );
    }
  }

  private async getTaxonomyCodes(
    queryVector: number[],
    tenantId: string,
  ): Promise<PredictedTaxonomy[]> {
    try {
      const result = await this.elasticsearchService.search<{
        code: string;
        name: string;
      }>({
        index: 'hybrid_taxonomies',
        size: TAXONOMY_K,
        track_total_hits: false,
        _source: ['code', 'name'],
        knn: {
          field: 'embedding',
          query_vector: queryVector,
          k: TAXONOMY_K,
          num_candidates: TAXONOMY_NUM_CANDIDATES,
          filter: [{ term: { tenant_id: tenantId } }],
        },
      });

      return result.hits.hits
        .filter((h) => Boolean(h._source?.code))
        .map((h) => ({
          code: h._source!.code,
          name: h._source!.name ?? '',
          score: h._score ?? 0,
        }));
    } catch (error) {
      this.logger.warn(
        `Taxonomy code lookup failed, continuing without boost: ${error.message}`,
      );
      return [];
    }
  }

  /**
   * Nested terms filter constraining results to a set of taxonomy codes.
   * Shared by the hybrid search hard scope and getDocumentsCount.
   */
  private buildHardTaxonomyScopeFilter(
    codes: string[],
  ): QueryDslQueryContainer {
    return {
      nested: {
        path: 'taxonomies',
        query: { terms: { 'taxonomies.code': codes } },
      },
    };
  }

  /**
   * One nested constant_score clause per predicted code. constant_score keeps
   * each contribution equal to the boost (no term-IDF noise); the bool sums
   * matching clauses, so a doc carrying several predicted codes accumulates
   * them and the highest-scoring predicted code contributes the most.
   * boost = BASE_TAXONOMY_BOOST * score * (1 + 0.5 / (1 + i))
   */
  private buildTaxonomyBoostClauses(
    predicted: PredictedTaxonomy[],
  ): QueryDslQueryContainer[] {
    return predicted.map((sc, i) => ({
      nested: {
        path: 'taxonomies',
        query: {
          constant_score: {
            filter: { term: { 'taxonomies.code': sc.code } },
            boost: BASE_TAXONOMY_BOOST * sc.score * (1 + 0.5 / (1 + i)),
          },
        },
        score_mode: 'max',
      },
    }));
  }

  private buildLexicalShouldClauses(
    queryStr: string,
  ): QueryDslQueryContainer[] {
    const queryLower = queryStr.toLowerCase();

    return [
      { term: { 'name.lc': { value: queryLower, boost: BM25_NAME_BOOST } } },
      { prefix: { 'name.lc': { value: queryLower, boost: BM25_NAME_BOOST } } },
      { match: { 'name.edge': { query: queryStr, boost: BM25_NAME_BOOST } } },
      { match_phrase: { name: { query: queryStr, boost: BM25_NAME_BOOST } } },
      {
        multi_match: {
          operator: 'or',
          minimum_should_match: '2<75%',
          fields: SearchUtilsService.FIELDS_TO_QUERY,
          query: queryStr,
        },
      },
      {
        nested: {
          path: 'taxonomies',
          query: {
            multi_match: {
              analyzer: 'standard',
              operator: 'or',
              minimum_should_match: '2<75%',
              fields: SearchUtilsService.NESTED_FIELDS_TO_QUERY,
              query: queryStr,
            },
          },
        },
      },
    ];
  }

  private buildScoreFunctions(
    queryVector: number[],
    coords: number[] | undefined,
    distance: number,
  ): QueryDslFunctionScoreContainer[] {
    const functions: QueryDslFunctionScoreContainer[] = [
      {
        script_score: {
          script: {
            source: "cosineSimilarity(params.qv, 'embedding') + 1.0",
            params: { qv: queryVector },
          },
        },
        weight: VECTOR_SCORE_WEIGHT,
      },
    ];

    if (coords) {
      const [lon, lat] = coords;
      const scale =
        distance > 0 ? `${distance}mi` : `${GEO_DEFAULT_SCALE_MI}mi`;
      functions.push({
        gauss: {
          'location.point': {
            origin: { lat, lon },
            scale,
            offset: '0mi',
            decay: 0.5,
          },
        },
        weight: GEO_GAUSS_WEIGHT,
      });
    }

    return functions;
  }

  private buildHybridQuery(args: {
    index: string;
    queryStr: string;
    queryVector: number[];
    predicted: PredictedTaxonomy[];
    filters: QueryDslQueryContainer[];
    coords: number[] | undefined;
    distance: number;
    page: number;
    limit: number;
    aggs: Aggregations;
  }): SearchRequest {
    const {
      index,
      queryStr,
      queryVector,
      predicted,
      filters,
      coords,
      distance,
      page,
      limit,
      aggs,
    } = args;

    // Browse mode (empty query): omit lexical should clauses; filters + vector +
    // geo + taxonomy boosts still produce a valid ranked, counted, paginated set.
    const lexicalShould = queryStr
      ? this.buildLexicalShouldClauses(queryStr)
      : [];
    const taxonomyShould = this.buildTaxonomyBoostClauses(predicted);
    const should = [...lexicalShould, ...taxonomyShould];

    // pinned/priority tiering lives in sort (not function_score); _score carries
    // the hybrid signal within a tier; service_at_location_id is the unique
    // tiebreaker for deterministic page boundaries.
    const sort: Sort = [
      { pinned: 'desc' },
      { priority: 'desc' },
      '_score',
      { service_at_location_id: 'asc' },
    ];

    return {
      index,
      from: (page - 1) * limit,
      size: limit,
      track_total_hits: true,
      _source: { excludes: ['embedding', 'service_area'] },
      aggs,
      query: {
        function_score: {
          query: {
            bool: {
              // Intentional: filters define the matched population; should
              // clauses and functions only rank. Do NOT set to 1.
              minimum_should_match: 0,
              filter: filters,
              should,
            },
          },
          functions: this.buildScoreFunctions(queryVector, coords, distance),
          score_mode: 'sum',
          boost_mode: 'sum',
        },
      },
      sort,
    };
  }

  /**
   * Mirrors the logic in src/common/lib/utils.ts getIndexName but only
   * returns the language portion since hybrid indices are not tenant-prefixed.
   */
  private sanitizeLang(lang: string): string {
    const preferred = lang.split(',')[0].trim().toLowerCase();
    const parts = preferred.split('-');
    const base = parts[0];

    if (parts.length > 1 && parts[1].length === 4) {
      return `${base}_${parts[1]}`;
    }

    return base;
  }
}
