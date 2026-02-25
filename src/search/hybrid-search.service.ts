import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import {
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
import { FusedHit } from './types/fused-hit';
import { EmbeddingResponse } from './types/embedding-response';

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
const RERANK_GEO_MAX = 10;
const RERANK_PINNED = 100;
const RERANK_PRIORITY_FACTOR = 2;

const BM25_NAME_BOOST = 15;
const BM25_TAXONOMY_BOOST = 10;

@Injectable()
export class HybridSearchService {
  private readonly logger = new Logger(HybridSearchService.name);
  private readonly embeddingBaseUrl: string;
  private readonly embeddingModel: string;

  constructor(
    private readonly elasticsearchService: ElasticsearchService,
    private readonly configService: ConfigService,
  ) {
    this.embeddingBaseUrl =
      this.configService.get<string>('EMBEDDING_BASE_URL');
    this.embeddingModel = this.configService.get<string>('EMBEDDING_MODEL');
  }

  async searchHybrid(options: {
    headers: HeadersDto;
    query: SearchQueryDto;
    body?: SearchBodyDto;
  }): Promise<SearchResponse> {
    const { headers, query: q } = options;
    const { query, page, limit, filters, coords, distance, geo_type } = q;
    const { geometry } = options.body || {};
    const tenantId = headers['x-tenant-id'];
    const lang = headers['accept-language'] || 'en';
    const queryStr = typeof query === 'string' ? query : String(query);

    const index = `hybrid_search_resources_${this.sanitizeLang(lang)}`;

    this.logger.debug(
      `Hybrid search — tenant=${tenantId}, index=${index}, query="${queryStr}"`,
    );

    const queryVector = await this.embedQuery(queryStr);

    const predictedCodes = await this.getTaxonomyCodes(queryVector, tenantId);
    this.logger.debug(`Predicted taxonomy codes: ${predictedCodes.join(', ')}`);

    const baseFilters = SearchUtilsService.buildFilters(
      filters,
      coords,
      distance,
      geo_type,
      geometry,
    );
    baseFilters.unshift({ term: { tenant_id: tenantId } });

    const { bm25Hits, knnHits } = await this.retrieveCandidates(
      index,
      queryStr,
      queryVector,
      predictedCodes,
      baseFilters,
      coords,
      distance,
    );

    const fused = this.fuseRRF(bm25Hits, knnHits);

    const reranked = this.rerank(
      fused,
      queryStr,
      predictedCodes,
      coords,
      distance ?? 0,
    );

    const pageSize = limit || 25;
    const start = (page - 1) * pageSize;
    const pageHits = reranked.slice(start, start + pageSize);

    const hits = pageHits.map((h) => ({
      _index: h._index,
      _id: h._id,
      _score: h.rrfScore,
      _source: h._source,
    }));

    return {
      search: {
        took: 0, // placeholder — combined latency is not tracked
        timed_out: false,
        _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
        hits: {
          total: { value: reranked.length, relation: 'eq' },
          max_score: hits[0]?._score ?? null,
          hits: hits as SearchHit[],
        },
      },
      facets: {},
      facets_values: {},
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
        headers: { 'Content-Type': 'application/json' },
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
  ): Promise<string[]> {
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
        .map((h) => h._source?.code)
        .filter((code): code is string => Boolean(code));
    } catch (error) {
      this.logger.warn(
        `Taxonomy code lookup failed, continuing without boost: ${error.message}`,
      );
      return [];
    }
  }

  private buildBM25Body(
    query: string,
    predictedCodes: string[],
    filters: QueryDslQueryContainer[],
    coords: number[] | undefined,
    distance: number,
  ): MsearchMultisearchBody {
    const queryLower = query.toLowerCase();
    this.logger.debug('BM25 query body', JSON.stringify({ filters }, null, 2));

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

    const taxonomyShould: QueryDslQueryContainer[] =
      predictedCodes.length > 0
        ? [
            {
              nested: {
                path: 'taxonomies',
                query: {
                  terms: { 'taxonomies.code': predictedCodes },
                },
                score_mode: 'max',
                boost: BM25_TAXONOMY_BOOST,
              },
            },
          ]
        : [];

    const should = [...nameShould, ...intentShould, ...taxonomyShould];

    const functions: QueryDslFunctionScoreContainer[] = [
      { filter: { term: { pinned: true } }, weight: 2.0 },
      {
        field_value_factor: {
          field: 'priority',
          modifier: 'log1p',
          missing: 0,
        },
        weight: 1.0,
      },
    ];

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
      track_total_hits: false,
      _source: { excludes: ['embedding', 'service_area'] },
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
    this.logger.debug('kNN query body', JSON.stringify({ filters }, null, 2));
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
    predictedCodes: string[],
    filters: QueryDslQueryContainer[],
    coords: number[] | undefined,
    distance: number,
  ): Promise<{
    bm25Hits: EsSearchHit<SearchSource>[];
    knnHits: EsSearchHit<SearchSource>[];
  }> {
    const bm25Body = this.buildBM25Body(
      query,
      predictedCodes,
      filters,
      coords,
      distance,
    );
    const knnBody = this.buildKnnBody(queryVector, filters);

    this.logger.debug('BM25 body', JSON.stringify(bm25Body, null, 2));

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

    return { bm25Hits, knnHits };
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

    return Array.from(map.values())
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, RETRIEVAL_SIZE);
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
          for (let i = 0; i < predictedCodes.length; i++) {
            if (docCodes.has(predictedCodes[i])) {
              bonus += Math.max(RERANK_TAXONOMY_BASE - i * 5, 5);
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

        if (src.pinned) bonus += RERANK_PINNED;
        if (src.priority) bonus += src.priority * RERANK_PRIORITY_FACTOR;

        this.logger.debug(
          `Rerank bonus for ${src.service_at_location_id}: ${bonus.toFixed(2)} (name: ${nameLower}, predictedCodes: ${predictedCodes.join(
            ',',
          )}, docCodes: ${src.taxonomies
            ?.map((t) => t.code)
            .join(',')}, distanceBonus: ${coords ? bonus.toFixed(2) : 'N/A'})`,
        );

        return {
          ...hit,
          rrfScore: hit.rrfScore * 1000 + bonus,
        };
      })
      .sort((a, b) => b.rrfScore - a.rrfScore);
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
