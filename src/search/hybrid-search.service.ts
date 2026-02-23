import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { SearchHit as EsSearchHit } from '@elastic/elasticsearch/lib/api/types';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchBodyDto } from './dto/search-body.dto';
import { HeadersDto } from '../common/dto/headers.dto';
import { SearchResponse, SearchSource } from './dto/search-response.dto';
import {
  buildFilters,
  haversineDistanceMiles,
  parseLocationPoint,
} from './search-query.utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FusedHit {
  _id: string;
  _index: string;
  _source: SearchSource;
  rrfScore: number;
  /** Original BM25 score (if present) */
  bm25Score?: number;
  /** Original kNN score (if present) */
  knnScore?: number;
}

interface EmbeddingResponse {
  data: { embedding: number[]; index: number }[];
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fields queried in the BM25 general-intent multi_match (mirrors SearchService). */
const FIELDS_TO_QUERY = [
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

const NESTED_FIELDS_TO_QUERY = ['taxonomies.name', 'taxonomies.description'];

/** RRF fusion parameters */
const RRF_RANK_CONSTANT = 60;
const RRF_LEXICAL_WEIGHT = 1.0;
const RRF_KNN_WEIGHT = 0.8;

/** Candidate set sizes */
const RETRIEVAL_SIZE = 100;
const KNN_NUM_CANDIDATES = 400;
const TAXONOMY_K = 5;
const TAXONOMY_NUM_CANDIDATES = 100;

/** Rerank bonus weights */
const RERANK_NAME_EXACT = 50;
const RERANK_NAME_PREFIX = 30;
const RERANK_NAME_CONTAINS = 10;
const RERANK_TAXONOMY_BASE = 20;
const RERANK_GEO_MAX = 15;
const RERANK_PINNED = 100;
const RERANK_PRIORITY_FACTOR = 2;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

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

  // =========================================================================
  // Public entry point
  // =========================================================================

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

    // Phase 1a: embed query
    const queryVector = await this.embedQuery(queryStr);

    // Phase 1b: taxonomy code candidates
    const predictedCodes = await this.getTaxonomyCodes(queryVector, tenantId);
    this.logger.debug(`Predicted taxonomy codes: ${predictedCodes.join(', ')}`);

    // Phase 2: build shared filter set (tenant + geo + facets)
    const baseFilters = this.buildHybridFilters(
      tenantId,
      filters,
      coords,
      distance,
      geo_type,
      geometry,
    );

    // Phase 2: retrieve BM25 + kNN candidates via _msearch
    const { bm25Hits, knnHits } = await this.retrieveCandidates(
      index,
      queryStr,
      queryVector,
      predictedCodes,
      baseFilters,
      coords,
      distance,
    );

    // Phase 3: client-side RRF fusion
    const fused = this.fuseRRF(bm25Hits, knnHits);

    // Phase 4: lightweight rerank
    const reranked = this.rerank(
      fused,
      queryStr,
      predictedCodes,
      coords,
      distance ?? 0,
    );

    // Paginate
    const pageSize = limit || 25;
    const start = (page - 1) * pageSize;
    const pageHits = reranked.slice(start, start + pageSize);

    // Build response in the same shape as the standard search
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
          hits: hits as any,
        },
      },
      facets: {},
      facets_values: {},
    };
  }

  // =========================================================================
  // Phase 1a: embed query
  // =========================================================================

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

  // =========================================================================
  // Phase 1b: taxonomy code candidates
  // =========================================================================

  private async getTaxonomyCodes(
    queryVector: number[],
    tenantId: string,
  ): Promise<string[]> {
    try {
      const result = await this.elasticsearchService.search({
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

      return (
        result.hits.hits
          .map((h: any) => h._source?.code as string)
          .filter(Boolean) ?? []
      );
    } catch (error) {
      this.logger.warn(
        `Taxonomy code lookup failed, continuing without boost: ${error.message}`,
      );
      return [];
    }
  }

  // =========================================================================
  // Phase 2: hybrid retrieval via _msearch
  // =========================================================================

  private buildHybridFilters(
    tenantId: string,
    facets: Record<string, any>,
    coords: number[] | undefined,
    distance: number,
    geoType: string | undefined,
    geometry: any,
  ): any[] {
    // Shared filters from the utility (geo + facets)
    const filters = buildFilters(facets, coords, distance, geoType, geometry);

    // Always prepend tenant_id filter (hybrid indices are multi-tenant)
    filters.unshift({ term: { tenant_id: tenantId } });

    return filters;
  }

  /**
   * Build the BM25 (lexical) query body with function_score for pinned,
   * priority, geo decay, name booster pack, and taxonomy boost.
   */
  private buildBM25Body(
    query: string,
    predictedCodes: string[],
    filters: any[],
    coords: number[] | undefined,
    distance: number,
  ): Record<string, any> {
    const queryLower = query.toLowerCase();

    // Name booster pack (top-level name.* only)
    const nameShould: any[] = [
      { term: { 'name.lc': { value: queryLower, boost: 15 } } },
      { prefix: { 'name.lc': { value: queryLower, boost: 10 } } },
      { match: { 'name.edge': { query, boost: 8 } } },
      { match_phrase: { name: { query, boost: 12 } } },
    ];

    // General intent multi_match (same fields as standard keyword search)
    const intentShould: any[] = [
      {
        multi_match: {
          analyzer: 'standard',
          operator: 'AND',
          fields: FIELDS_TO_QUERY,
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
              fields: NESTED_FIELDS_TO_QUERY,
              query,
            },
          },
        },
      },
    ];

    // Taxonomy code boost (only if we have predictions)
    const taxonomyShould: any[] =
      predictedCodes.length > 0
        ? [
            {
              nested: {
                path: 'taxonomies',
                query: {
                  terms: { 'taxonomies.code': predictedCodes },
                },
                score_mode: 'max',
                boost: 6,
              },
            },
          ]
        : [];

    const should = [...nameShould, ...intentShould, ...taxonomyShould];

    // function_score functions
    const functions: any[] = [
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

    // Geo distance decay (optional)
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

  /**
   * Build the kNN query body.
   */
  private buildKnnBody(
    queryVector: number[],
    filters: any[],
  ): Record<string, any> {
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

  /**
   * Execute BM25 + kNN retrieval in a single _msearch call.
   */
  private async retrieveCandidates(
    index: string,
    query: string,
    queryVector: number[],
    predictedCodes: string[],
    filters: any[],
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

    // Log errors from individual responses if any
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

  // =========================================================================
  // Phase 3: client-side RRF fusion
  // =========================================================================

  fuseRRF(
    bm25Hits: EsSearchHit<SearchSource>[],
    knnHits: EsSearchHit<SearchSource>[],
  ): FusedHit[] {
    const map = new Map<string, FusedHit>();

    // Process BM25 hits
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

    // Process kNN hits
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

    // Sort by RRF score descending and take top RETRIEVAL_SIZE
    return Array.from(map.values())
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, RETRIEVAL_SIZE);
  }

  // =========================================================================
  // Phase 4: deterministic reranking
  // =========================================================================

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

        // 1. Name strength
        const nameLower = (src.name ?? '').toLowerCase();
        if (nameLower === queryLower) {
          bonus += RERANK_NAME_EXACT;
        } else if (nameLower.startsWith(queryLower)) {
          bonus += RERANK_NAME_PREFIX;
        } else if (nameLower.includes(queryLower)) {
          bonus += RERANK_NAME_CONTAINS;
        }

        // 2. Taxonomy match (decreasing bonus by prediction rank)
        if (src.taxonomies?.length && predictedCodes.length) {
          const docCodes = new Set(src.taxonomies.map((t) => t.code));
          for (let i = 0; i < predictedCodes.length; i++) {
            if (docCodes.has(predictedCodes[i])) {
              bonus += Math.max(RERANK_TAXONOMY_BASE - i * 5, 5);
            }
          }
        }

        // 3. Geo distance bonus
        if (coords) {
          const point = parseLocationPoint(src.location?.point);
          if (point) {
            const d = haversineDistanceMiles(
              coords[1],
              coords[0],
              point.lat,
              point.lon,
            );
            const maxDist = distance > 0 ? distance : 50;
            // Closer => higher bonus (linear decay, capped)
            const geoBonus = Math.max(0, RERANK_GEO_MAX * (1 - d / maxDist));
            bonus += geoBonus;
          }
        }

        // 4. Business rules
        if (src.pinned) bonus += RERANK_PINNED;
        if (src.priority) bonus += src.priority * RERANK_PRIORITY_FACTOR;

        return {
          ...hit,
          rrfScore: hit.rrfScore * 1000 + bonus,
        };
      })
      .sort((a, b) => b.rrfScore - a.rrfScore);
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  /**
   * Sanitize an accept-language value into a safe index suffix.
   * Mirrors the logic in src/common/lib/utils.ts getIndexName — but only
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
