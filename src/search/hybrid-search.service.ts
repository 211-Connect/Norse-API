import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import {
  AggregationsStringTermsAggregate,
  SearchHit as EsSearchHit,
  QueryDslQueryContainer,
  QueryDslFunctionScoreContainer,
  MsearchMultisearchBody,
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
import {
  FusedHit,
  EmbeddingResponse,
  Aggregations,
  RetrievalResult,
  ShardsInfo,
} from './types';
import { TenantConfigService } from '../cms-config/tenant-config.service';
import { CmsRedisService } from '../cms-config/cms-redis.service';

const RRF_RANK_CONSTANT = 60;
const RRF_LEXICAL_WEIGHT = 1.0;
const RRF_KNN_WEIGHT = 0.8;

const RETRIEVAL_SIZE = 100;
const KNN_NUM_CANDIDATES = 400;
const TAXONOMY_K = 5;
const TAXONOMY_NUM_CANDIDATES = 100;

const RERANK_NAME_EXACT = 50;
const RERANK_NAME_PREFIX = 30;
const RERANK_NAME_CONTAINS = 20;
const RERANK_TAXONOMY_BASE = 50;
const RERANK_TAXONOMY_PARENT = 25;
const RERANK_TAXONOMY_GRANDPARENT = 12;
const RERANK_GEO_MAX = 10;

const PATH_B_KNN_SIZE = 200;
const PATH_B_BUCKET_WEIGHTS = [8, 5, 3, 1] as const;

const BM25_NAME_BOOST = 15;
const TAXONOMY_SCORE_BASE_BOOST = 100;

@Injectable()
export class HybridSearchService {
  private readonly logger = new Logger(HybridSearchService.name);
  private readonly embeddingBaseUrl: string;
  private readonly embeddingModel: string;
  private readonly runpodApiKey: string;
  private readonly hybridSearchPath: string;

  constructor(
    private readonly elasticsearchService: ElasticsearchService,
    private readonly configService: ConfigService,
    private readonly tenantConfigService: TenantConfigService,
    private readonly cmsRedisService: CmsRedisService,
  ) {
    this.embeddingBaseUrl =
      this.configService.get<string>('EMBEDDING_BASE_URL');
    this.embeddingModel = this.configService.get<string>('EMBEDDING_MODEL');
    this.runpodApiKey = this.configService.get<string>('RUNPOD_API_KEY');
    this.hybridSearchPath =
      this.configService.get<string>('HYBRID_SEARCH_PATH') || 'path_b';
  }

  async searchHybrid(options: {
    headers: HeadersDto;
    query: SearchQueryDto;
    body?: SearchBodyDto;
  }): Promise<SearchResponse> {
    const { headers, query: q } = options;
    const { query, page, limit, filters, coords, distance, geo_type, query_path } = q;
    const { geometry } = options.body || {};
    const tenantId = headers['x-tenant-id'];
    const lang = headers['accept-language'] || 'en';
    const queryStr = typeof query === 'string' ? query : String(query);

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

    const predictedCodes = predictedTaxonomies.map((t) => t.code);
    this.logger.log(
      `[Hybrid search] - query="${queryStr}" | predicted codes: [${predictedCodes.join(', ')}] | names: [${predictedTaxonomies.map((t) => t.name).join(', ')}] | scores: [${predictedTaxonomies.map((t) => t.score.toFixed(4)).join(', ')}]`,
    );

    const baseFilters = SearchUtilsService.buildFilters(
      filters,
      coords,
      distance,
      geo_type,
      geometry,
    );
    baseFilters.unshift({ term: { tenant_id: tenantId } });

    const aggs = SearchUtilsService.buildFacetAggregations(tenantFacets, lang);
    const scoredCodes = await this.expandWithSeeAlso(predictedTaxonomies, tenantId);

    const pathArgs = {
      index,
      queryStr,
      queryVector,
      predictedCodes,
      scoredCodes,
      baseFilters,
      aggs,
      page: page ?? 1,
      limit: limit ?? 25,
      coords,
      distance: distance ?? 0,
      lang,
      tenantFacets,
    };

    const tRetrievalStart = performance.now();
    const activePath = query_path ?? this.hybridSearchPath;
    const result =
      activePath === 'path_b'
        ? await this.searchHybridPathB(pathArgs)
        : await this.searchHybridPathA(pathArgs);
    const tRetrievalMs = Math.round(performance.now() - tRetrievalStart);

    const totalMs = Math.round(performance.now() - t0);
    this.logger.log(
      `[Hybrid search] path=${activePath} | timings - embedding: ${tEmbedMs}ms | taxonomy lookup: ${tTaxonomyMs}ms | retrieval+ranking: ${tRetrievalMs}ms | total: ${totalMs}ms`,
    );

    return result;
  }

  private async searchHybridPathA(args: {
    index: string;
    queryStr: string;
    queryVector: number[];
    predictedCodes: string[];
    scoredCodes: Array<{ code: string; score: number }>;
    baseFilters: QueryDslQueryContainer[];
    aggs: Aggregations;
    page: number;
    limit: number;
    coords: number[] | undefined;
    distance: number;
    lang: string;
    tenantFacets: Awaited<ReturnType<TenantConfigService['getFacets']>>;
  }): Promise<SearchResponse> {
    const {
      index,
      queryStr,
      queryVector,
      predictedCodes,
      scoredCodes,
      baseFilters,
      aggs,
      page,
      limit,
      coords,
      distance,
      lang,
      tenantFacets,
    } = args;

    const { bm25Hits, knnHits, metadata } = await this.retrieveCandidates(
      index,
      queryStr,
      queryVector,
      scoredCodes,
      baseFilters,
      coords,
      distance,
      aggs,
    );

    const fused = this.fuseRRF(bm25Hits, knnHits);
    const reranked = this.rerank(fused, queryStr, predictedCodes, coords, distance);

    const start = (page - 1) * limit;
    const pageHits = reranked.slice(start, start + limit);

    const hits: SearchHit[] = pageHits.map((h) => {
      const normalizedFacets = SearchUtilsService.normalizeDocFacets(
        h._source,
        lang,
      );
      return {
        _index: h._index,
        _id: h._id,
        _score: h.rrfScore,
        _source: { ...h._source, facets: normalizedFacets },
      };
    });

    const facets = SearchUtilsService.transformAggregations(
      tenantFacets,
      metadata.aggregations,
      lang,
    );

    return {
      search: {
        took: metadata.took,
        timed_out: metadata.timedOut,
        _shards: metadata.shards,
        hits: {
          total: {
            value: metadata.bm25Total ?? reranked.length,
            relation: metadata.bm25Total != null ? 'gte' : 'eq',
          },
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
  ): Promise<Array<{ code: string; name: string; score: number }>> {
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

  private buildBM25Body(
    query: string,
    scoredCodes: Array<{ code: string; score: number }>,
    filters: QueryDslQueryContainer[],
    coords: number[] | undefined,
    distance: number,
    aggs: Aggregations,
  ): MsearchMultisearchBody {
    const queryLower = query.toLowerCase();

    const nameShould: QueryDslQueryContainer[] = [
      { term: { 'name.lc': { value: queryLower, boost: BM25_NAME_BOOST } } },
      { prefix: { 'name.lc': { value: queryLower, boost: BM25_NAME_BOOST } } },
      { match: { 'name.edge': { query, boost: BM25_NAME_BOOST } } },
      { match_phrase: { name: { query, boost: BM25_NAME_BOOST } } },
    ];

    const intentShould: QueryDslQueryContainer[] = [
      {
        multi_match: {
          operator: 'or',
          minimum_should_match: '2<75%',
          fields: SearchUtilsService.FIELDS_TO_QUERY,
          query,
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
              query,
            },
          },
        },
      },
    ];

    const taxonomyShould: QueryDslQueryContainer[] = scoredCodes.map((sc, i) => ({
      nested: {
        path: 'taxonomies',
        query: {
          term: { 'taxonomies.code': { value: sc.code } },
        },
        score_mode: 'max',
        boost: TAXONOMY_SCORE_BASE_BOOST * sc.score * (1 + 0.5 / (1 + i)),
      },
    }));

    const should = [...nameShould, ...intentShould, ...taxonomyShould];

    const functions: QueryDslFunctionScoreContainer[] = [];

    if (coords) {
      const [lon, lat] = coords;
      const scale = distance > 0 ? `${distance}mi` : '5mi';
      functions.push({
        gauss: {
          'location.point': {
            origin: { lat, lon },
            scale,
            offset: '0mi',
            decay: 0.5,
          },
        },
        weight: 1.5,
      });
    }

    return {
      size: RETRIEVAL_SIZE,
      track_total_hits: true,
      _source: { excludes: ['embedding', 'service_area'] },
      aggs,
      query: {
        function_score: {
          query: {
            bool: {
              filter: filters,
              should,
              minimum_should_match: 1,
            },
          },
          functions,
          score_mode: 'sum',
          boost_mode: 'sum',
        },
      },
    };
  }

  private buildKnnBody(
    queryVector: number[],
    filters: QueryDslQueryContainer[],
  ): MsearchMultisearchBody {
    return {
      size: RETRIEVAL_SIZE,
      track_total_hits: false,
      _source: { excludes: ['embedding', 'service_area'] },
      knn: {
        field: 'embedding',
        query_vector: queryVector,
        k: RETRIEVAL_SIZE,
        num_candidates: KNN_NUM_CANDIDATES,
        filter: filters,
      },
    };
  }

  private async retrieveCandidates(
    index: string,
    query: string,
    queryVector: number[],
    scoredCodes: Array<{ code: string; score: number }>,
    filters: QueryDslQueryContainer[],
    coords: number[] | undefined,
    distance: number,
    aggs: Aggregations,
  ): Promise<RetrievalResult> {
    const bm25Body = this.buildBM25Body(
      query,
      scoredCodes,
      filters,
      coords,
      distance,
      aggs,
    );
    const knnBody = this.buildKnnBody(queryVector, filters);

    const result = await this.elasticsearchService.msearch<SearchSource>({
      searches: [{ index }, bm25Body, { index }, knnBody],
    });

    const responses = result.responses;
    const bm25Resp = responses[0];
    const knnResp = responses[1];

    const bm25Hits =
      'hits' in bm25Resp
        ? (bm25Resp.hits.hits as EsSearchHit<SearchSource>[])
        : [];
    const knnHits =
      'hits' in knnResp
        ? (knnResp.hits.hits as EsSearchHit<SearchSource>[])
        : [];

    if ('error' in bm25Resp) {
      this.logger.error(
        `BM25 msearch error: ${JSON.stringify(bm25Resp.error)}`,
      );
    }
    if ('error' in knnResp) {
      this.logger.error(`kNN msearch error: ${JSON.stringify(knnResp.error)}`);
    }

    this.logger.debug(
      `Retrieved ${bm25Hits.length} BM25 hits, ${knnHits.length} kNN hits`,
    );

    const DEFAULT_SHARDS: ShardsInfo = {
      total: 0,
      successful: 0,
      skipped: 0,
      failed: 0,
    };

    const extractShards = (resp: typeof bm25Resp): ShardsInfo =>
      'hits' in resp && resp._shards
        ? {
            total: resp._shards.total,
            successful: resp._shards.successful,
            skipped: resp._shards.skipped ?? 0,
            failed: resp._shards.failed,
          }
        : DEFAULT_SHARDS;

    const shards = SearchUtilsService.mergeShardsInfo(
      extractShards(bm25Resp),
      extractShards(knnResp),
    );

    const took = Math.max(
      'hits' in bm25Resp ? (bm25Resp.took ?? 0) : 0,
      'hits' in knnResp ? (knnResp.took ?? 0) : 0,
    );

    const timedOut =
      ('hits' in bm25Resp && bm25Resp.timed_out === true) ||
      ('hits' in knnResp && knnResp.timed_out === true);

    const aggregations =
      'hits' in bm25Resp
        ? (bm25Resp.aggregations as
            | Record<string, AggregationsStringTermsAggregate>
            | undefined)
        : undefined;

    const bm25TotalRaw =
      'hits' in bm25Resp ? bm25Resp.hits.total : undefined;
    const bm25Total =
      bm25TotalRaw == null
        ? undefined
        : typeof bm25TotalRaw === 'number'
          ? bm25TotalRaw
          : bm25TotalRaw.value;

    return {
      bm25Hits,
      knnHits,
      metadata: { took, timedOut, shards, aggregations, bm25Total },
    };
  }

  fuseRRF(
    bm25Hits: EsSearchHit<SearchSource>[],
    knnHits: EsSearchHit<SearchSource>[],
  ): FusedHit[] {
    const map = new Map<string, FusedHit>();

    bm25Hits.forEach((hit, idx) => {
      const id = hit._id!;
      const rank = idx + 1;
      const score = RRF_LEXICAL_WEIGHT * (1 / (RRF_RANK_CONSTANT + rank));

      map.set(id, {
        _id: id,
        _index: hit._index!,
        _source: hit._source!,
        rrfScore: score,
        bm25Score: hit._score ?? undefined,
      });
    });

    knnHits.forEach((hit, idx) => {
      const id = hit._id!;
      const rank = idx + 1;
      const score = RRF_KNN_WEIGHT * (1 / (RRF_RANK_CONSTANT + rank));

      const existing = map.get(id);
      if (existing) {
        existing.rrfScore += score;
        existing.knnScore = hit._score ?? undefined;
      } else {
        map.set(id, {
          _id: id,
          _index: hit._index!,
          _source: hit._source!,
          rrfScore: score,
          knnScore: hit._score ?? undefined,
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => b.rrfScore - a.rrfScore);
  }

  rerank(
    candidates: FusedHit[],
    query: string,
    predictedCodes: string[],
    coords: number[] | undefined,
    distance: number,
  ): FusedHit[] {
    const queryLower = query.toLowerCase();

    return candidates
      .map((hit) => {
        let bonus = 0;
        const src = hit._source;

        const nameLower = (src.name ?? '').toLowerCase();
        if (nameLower === queryLower) {
          bonus += RERANK_NAME_EXACT;
        } else {
          const queryWords = queryLower.split(/\s+/).filter(Boolean);
          for (const word of queryWords) {
            if (nameLower.startsWith(word)) {
              bonus += RERANK_NAME_PREFIX;
            } else if (nameLower.includes(word)) {
              bonus += RERANK_NAME_CONTAINS;
            }
          }
        }

        if (src.taxonomies?.length && predictedCodes.length) {
          const docCodes = new Set(src.taxonomies.map((t) => t.code));
          const predictedSet = new Set(predictedCodes);

          // Direct match bonus (tiered by rank position)
          for (let i = 0; i < predictedCodes.length; i++) {
            if (docCodes.has(predictedCodes[i])) {
              bonus += Math.max(RERANK_TAXONOMY_BASE - i * 5, 5);
            }
          }

          // Hierarchical bonus: doc's taxonomy is a child/grandchild of a predicted code
          for (const tax of src.taxonomies) {
            const parentCodes: string[] = (tax as any).parent_codes ?? [];
            if (parentCodes.length > 0 && predictedSet.has(parentCodes[0])) {
              bonus += RERANK_TAXONOMY_PARENT;
            } else if (
              parentCodes.length > 1 &&
              predictedSet.has(parentCodes[1])
            ) {
              bonus += RERANK_TAXONOMY_GRANDPARENT;
            }
          }
        }

        if (coords) {
          const point = SearchUtilsService.parseLocationPoint(
            src.location?.point,
          );
          if (point) {
            const d = SearchUtilsService.haversineDistanceMiles(
              coords[1],
              coords[0],
              point.lat,
              point.lon,
            );
            const maxDist = distance > 0 ? distance : 50;
            const geoBonus = Math.max(0, RERANK_GEO_MAX * (1 - d / maxDist));
            bonus += geoBonus;
          }
        }

        return {
          ...hit,
          rrfScore: hit.rrfScore * 1000 + bonus,
        };
      })
      .sort((a, b) => b.rrfScore - a.rrfScore);
  }

  private async expandWithSeeAlso(
    predicted: Array<{ code: string; score: number }>,
    tenantId: string,
  ): Promise<Array<{ code: string; score: number }>> {
    if (predicted.length === 0) return [];

    try {
      const codes = predicted.map((p) => p.code);
      const keys = codes.map((c) => `tax:expansion:${tenantId}:${c}`);
      const rawValues = await this.cmsRedisService.mGet(keys);

      const scoreMap = new Map<string, number>();
      for (const p of predicted) {
        scoreMap.set(p.code, p.score);
      }

      // Expanded codes get the parent's score * 0.7
      for (let i = 0; i < rawValues.length; i++) {
        const raw = rawValues[i];
        if (!raw) continue;
        const related: string[] = JSON.parse(raw);
        const parentScore = predicted[i].score * 0.7;
        for (const code of related) {
          if (!scoreMap.has(code)) {
            scoreMap.set(code, parentScore);
          }
        }
      }

      return Array.from(scoreMap.entries()).map(([code, score]) => ({ code, score }));
    } catch (error) {
      this.logger.warn(
        `See-also expansion failed, using original codes: ${(error as Error).message}`,
      );
      return predicted;
    }
  }

  private async searchHybridPathB(args: {
    index: string;
    queryStr: string;
    queryVector: number[];
    predictedCodes: string[];
    scoredCodes: Array<{ code: string; score: number }>;
    baseFilters: QueryDslQueryContainer[];
    aggs: Aggregations;
    page: number;
    limit: number;
    coords: number[] | undefined;
    distance: number;
    lang: string;
    tenantFacets: Awaited<ReturnType<TenantConfigService['getFacets']>>;
  }): Promise<SearchResponse> {
    const {
      index,
      queryStr,
      queryVector,
      scoredCodes,
      baseFilters,
      aggs,
      page,
      limit,
      coords,
      distance,
      lang,
      tenantFacets,
    } = args;

    const semanticBuckets = await this.getSemanticBoostIds(
      index,
      queryVector,
      baseFilters,
    );

    const searchBody = this.buildSemanticBoostedQuery(
      queryStr,
      semanticBuckets,
      scoredCodes,
      baseFilters,
      coords,
      distance,
      aggs,
      page,
      limit,
    );

    const esResult = await this.elasticsearchService.search<SearchSource>({
      index,
      ...searchBody,
    } as any);

    const rawHits = esResult.hits.hits as EsSearchHit<SearchSource>[];
    const hits: SearchHit[] = rawHits.map((h) => {
      const normalizedFacets = SearchUtilsService.normalizeDocFacets(
        h._source!,
        lang,
      );
      return {
        _index: h._index!,
        _id: h._id!,
        _score: h._score ?? 0,
        _source: { ...h._source!, facets: normalizedFacets },
      };
    });

    const total = esResult.hits.total;
    const totalValue =
      typeof total === 'number' ? total : (total?.value ?? rawHits.length);
    const totalRelation =
      typeof total === 'object' && total !== null ? total.relation : 'eq';

    const aggregations = esResult.aggregations as
      | Record<string, AggregationsStringTermsAggregate>
      | undefined;

    const facets = SearchUtilsService.transformAggregations(
      tenantFacets,
      aggregations,
      lang,
    );

    return {
      search: {
        took: esResult.took ?? 0,
        timed_out: esResult.timed_out ?? false,
        _shards: esResult._shards
          ? {
              total: esResult._shards.total,
              successful: esResult._shards.successful,
              skipped: esResult._shards.skipped ?? 0,
              failed: esResult._shards.failed,
            }
          : { total: 0, successful: 0, skipped: 0, failed: 0 },
        hits: {
          total: { value: totalValue, relation: totalRelation },
          max_score: hits[0]?._score ?? null,
          hits,
        },
      },
      facets,
    };
  }

  private async getSemanticBoostIds(
    index: string,
    queryVector: number[],
    filters: QueryDslQueryContainer[],
  ): Promise<{ ids: string[]; weight: number }[]> {
    const result = await this.elasticsearchService.search<SearchSource>({
      index,
      size: PATH_B_KNN_SIZE,
      track_total_hits: false,
      _source: false,
      knn: {
        field: 'embedding',
        query_vector: queryVector,
        k: PATH_B_KNN_SIZE,
        num_candidates: KNN_NUM_CANDIDATES * 2,
        filter: filters,
      },
    } as any);

    const hits = result.hits.hits;
    const slices = [
      hits.slice(0, 20),
      hits.slice(20, 50),
      hits.slice(50, 100),
      hits.slice(100),
    ];

    return slices.map((slice, i) => ({
      ids: slice.map((h) => h._id!),
      weight: PATH_B_BUCKET_WEIGHTS[i],
    }));
  }

  private buildSemanticBoostedQuery(
    query: string,
    semanticBuckets: { ids: string[]; weight: number }[],
    scoredCodes: Array<{ code: string; score: number }>,
    filters: QueryDslQueryContainer[],
    coords: number[] | undefined,
    distance: number,
    aggs: Aggregations,
    page: number,
    limit: number,
  ) {
    const queryLower = query.toLowerCase();

    const nameShould: QueryDslQueryContainer[] = [
      { term: { 'name.lc': { value: queryLower, boost: BM25_NAME_BOOST } } },
      { prefix: { 'name.lc': { value: queryLower, boost: BM25_NAME_BOOST } } },
      { match: { 'name.edge': { query, boost: BM25_NAME_BOOST } } },
      { match_phrase: { name: { query, boost: BM25_NAME_BOOST } } },
    ];

    const intentShould: QueryDslQueryContainer[] = [
      {
        multi_match: {
          operator: 'or',
          minimum_should_match: '2<75%',
          fields: SearchUtilsService.FIELDS_TO_QUERY,
          query,
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
              query,
            },
          },
        },
      },
    ];

    const taxonomyShould: QueryDslQueryContainer[] = scoredCodes.map((sc, i) => ({
      nested: {
        path: 'taxonomies',
        query: {
          term: { 'taxonomies.code': { value: sc.code } },
        },
        score_mode: 'max',
        boost: TAXONOMY_SCORE_BASE_BOOST * sc.score * (1 + 0.5 / (1 + i)),
      },
    }));

    // kNN bucket IDs as should clauses — ensures pure-semantic matches
    // contribute to matching (not just scoring), preserving hybrid recall.
    const knnShould: QueryDslQueryContainer[] = semanticBuckets
      .filter((b) => b.ids.length > 0)
      .map((b) => ({
        ids: { values: b.ids, boost: b.weight },
      }));

    const functions: QueryDslFunctionScoreContainer[] = [];

    if (coords) {
      const [lon, lat] = coords;
      const scale = distance > 0 ? `${distance}mi` : '5mi';
      functions.push({
        gauss: {
          'location.point': {
            origin: { lat, lon },
            scale,
            offset: '0mi',
            decay: 0.5,
          },
        },
        weight: 1.5,
      });
    }

    return {
      size: limit,
      from: (page - 1) * limit,
      track_total_hits: true,
      _source: { excludes: ['embedding', 'service_area'] },
      sort: [{ _score: { order: 'desc' } }],
      aggs,
      query: {
        function_score: {
          query: {
            bool: {
              filter: filters,
              should: [...nameShould, ...intentShould, ...taxonomyShould, ...knnShould],
              minimum_should_match: 1,
            },
          },
          functions,
          score_mode: 'sum',
          boost_mode: 'sum',
        },
      },
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
