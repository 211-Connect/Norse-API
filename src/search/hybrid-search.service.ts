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
import { SearchResourcesQueryDto } from './dto/search-query.dto';
import { SearchResourcesBodyDto } from './dto/search-body.dto';
import { HeadersDto } from '../common/dto/headers.dto';
import {
  SearchHit,
  SearchResponse,
  SearchSource,
} from './dto/search-response.dto';
import { HYBRID_SORT_FIELDS, SearchUtilsService } from './search-utils.service';
import { EmbeddingResponse, Aggregations } from './types';
import { TenantConfigService } from '../cms-config/tenant-config.service';
import {
  PinnedResourcesMode,
  SearchConfigCache,
} from '../cms-config/types/search-config-cache';
import { RequestCacheService } from 'src/common/services/cache/request-cache.service';
import { hybridDocumentsCountCacheKey } from './internal/cache-key/hybrid-documents-count-cache-key';
import { relevanceCutoffCacheKey } from './internal/cache-key/relevance-cutoff-cache-key';
import {
  DEFAULT_RELATIVE_TO_MAX_OPTIONS,
  DEFAULT_SCORE_GAP_OPTIONS,
  detectRelativeToMaxCutoff,
  detectScoreGapCutoff,
} from './internal/relevance-cutoff/detect-cutoff';
import { RelevanceCutoffStrategy } from './internal/relevance-cutoff/types';
import { RelevanceCutoffDto } from './dto/search-response.dto';

// Vector weight mirrors the old kNN boost; tune to shift lexical vs semantic balance.
// After switching to Math.max(0, cosine) the effective range is ~0–0.4 vs the old
// ~1.0–1.4 (+1.0 floor), so this is raised from 50 to 100. Re-tune empirically after deploy.
const VECTOR_SCORE_WEIGHT = 100;
// Base boost for a matched predicted taxonomy code; multiplied by the code's
// prediction (kNN cosine) score and a small rank-decay factor.
const BASE_TAXONOMY_BOOST = 50;
// Additive weight of the proximity signal in the hybrid score. Tuned to 25 (see ISS-1367).
const GEO_GAUSS_WEIGHT = 25;
const GEO_DEFAULT_SCALE_MI = 5;

// When a tenant sets `pinned_resources_mode` to `boost`, pinned/priority stop
// being hard sort tiers and become small score contributions instead (so a
// large pinned pool no longer floods the first pages). Tune these like the
// other weights.
const PINNED_SCORE_BOOST = 5;
const PRIORITY_SCORE_WEIGHT = 1;

const BM25_NAME_BOOST = 15;
const BM25_SERVICE_NAME_BOOST = 10;
const BM25_ORG_NAME_BOOST = 6;
// use_references are curated taxonomy aliases (e.g. "Girl Scouts", "Scouts",
// "Scouting" for Scouting Programs). A match there is an intent signal, but at 12
// it outweighed name and description hits badly enough to return a pet service as
// the best match for "prescription assistance" (EXP-019 traced the contamination
// to this clause alone; EXP-021 swept 12/6/3/0).
//
// 6 removes that result with nothing else degraded. Re-measured 2026-09-22 on two
// tenants with cutoff off: alias-benefit queries 0/6 changed on both; top-1 churn
// 2/20 Santa Cruz (the fixed query plus "transportation", which moved between two
// transportation services) and 1/20 Nebraska ("free dental care", which improved
// from a general clinic to a dental one). Membership totals unchanged, as expected
// for a ranking-only change. Only at 0 does an alias query break ("food stamps").
//
// Note it removes a wrong answer without producing a right one: Santa Cruz has no
// prescription-assistance resource, so that query still returns something unrelated,
// just not absurdly so. Nebraska, which does have one, was unaffected at either
// setting — where a correct answer exists this clause was not what surfaced it.
const BM25_TAXONOMY_USE_REF_BOOST = 6;

const TAXONOMY_K = 10;
const TAXONOMY_NUM_CANDIDATES = 500;

/**
 * How many top-ranked candidates the cutoff probe examines. A cut is never
 * inferred from beyond this window: if no elbow is found inside it, the
 * response says `candidate_ceiling` and nothing is trimmed. Silent partial
 * cuts would be worse than no cut at all.
 */
const CUTOFF_CANDIDATE_CEILING = 300;

/**
 * Largest cut we will enumerate into an `ids` filter.
 *
 * `relative_to_max` locates its cut point with a `min_score` count rather than
 * by walking a candidate window, so it is not limited to the first 300 results
 * and routinely finds cuts beyond them — on Nebraska 211 the 0.2 threshold
 * survives at 388 documents of 27,452, which the window could never see. What
 * still has to be bounded is the id list handed to the main query, so beyond
 * this the response says `cut_too_large` rather than trimming partially.
 */
const MAX_ENUMERATED_CUT = 1000;

/**
 * Window used only to satisfy the distinct-service floor when a threshold cut
 * lands on too few services. Small, and fetched only in that case.
 */
const SERVICE_FLOOR_WINDOW = 200;

/**
 * A cut has to actually reduce the set to be worth calling a cut.
 *
 * Found by running it: `asdfqwerzxcv` on Santa Cruz kept 567 of 568 — one
 * document above the threshold, reported as `applied: true` with a
 * `cutoff_score`, which reads as a considered decision and is nothing of the
 * sort. Anything retaining more than this fraction of the matched set is a flat
 * distribution with a rounding error on the end, and the honest answer is that
 * there was no elbow.
 */
const MIN_CUT_REDUCTION = 0.9;

/**
 * How long a probe decision is reused, in ms.
 *
 * The cache exists for one narrow reason — pages 2..n of a single search must
 * see the same kept set — so it only has to outlive a user paging through
 * results, not an hour of traffic. `RequestCacheService`'s one-hour default is
 * far longer than that, and the extra window is all downside: the readers
 * reindex blue/green, and a reindex inside the TTL changes scores and can
 * delete documents, leaving `relevance_cutoff.kept` reporting a number the main
 * query no longer returns. Document `_id`s are stable (`{tenant}:{sal}:{lang}`)
 * so the ids filter still resolves — it just resolves to a stale decision, and
 * silently.
 */
const CUTOFF_PROBE_TTL_MS = 5 * 60 * 1000;

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
    query: SearchResourcesQueryDto;
    body?: SearchResourcesBodyDto;
  }): Promise<SearchResponse> {
    const { headers, query: q } = options;
    const {
      query,
      page,
      limit,
      filters,
      organization_id,
      coords,
      distance,
      age,
      geo_type,
      sort,
    } = q;
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

    // Browse mode (empty query): skip embedding — many embedding servers 400 on
    // empty input, causing a 503. Filters + sort carry the result set; vector
    // scoring is simply omitted for browse.
    const wantsVector = queryStr.trim().length > 0;
    const tEmbedStart = performance.now();

    const [embedResult, tenantFacets, searchConfig] = await Promise.all([
      wantsVector
        ? this.embedQuery(queryStr).catch((err: Error) => {
            this.logger.warn(
              `Embedding failed, falling back to lexical-only: ${err.message}`,
            );
            return undefined;
          })
        : Promise.resolve(undefined),
      this.tenantConfigService.getFacets(tenantId),
      this.tenantConfigService.getSearchConfig(tenantId),
    ]);

    const queryVector = embedResult;
    const pinnedMode = this.resolvePinnedResourcesMode(searchConfig);
    const tEmbedMs = Math.round(performance.now() - tEmbedStart);

    const tTaxonomyStart = performance.now();
    // Taxonomy prediction requires a query vector; skip if embedding was
    // skipped (browse) or failed (lexical fallback).
    const predictedTaxonomies = queryVector
      ? await this.getTaxonomyCodes(queryVector, tenantId)
      : [];
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
      organization_id,
    );
    baseFilters.unshift({ term: { tenant_id: tenantId } });

    if (hardScopeCodes.length > 0) {
      baseFilters.push(this.buildHardTaxonomyScopeFilter(hardScopeCodes));
    }

    // Opt-in only (ISS-1752). With `relevance_cutoff` absent or `off` nothing
    // below runs, no extra Elasticsearch call is made, and the request built
    // further down is identical to what it has always been.
    const strategy = q.relevance_cutoff ?? 'off';
    let cutoff: RelevanceCutoffDto | undefined;

    if (strategy !== 'off') {
      const cacheKey = relevanceCutoffCacheKey({
        tenantId,
        lang,
        queryStr,
        strategy,
        filters,
        taxonomies: hardScopeCodes,
        coords,
        distance,
        age,
        geoType: geo_type,
        organizationId: organization_id,
        geometry,
        pinnedMode,
      });

      // Cached so pages 2..n of one search reuse a single probe rather than
      // re-running it — and so the kept set cannot drift between pages.
      const probed = await this.requestCacheService.getOrSet(
        cacheKey,
        () =>
          this.probeRelevanceCutoff({
          index,
          queryStr,
          queryVector,
          predicted: predictedTaxonomies,
          filters: baseFilters,
          pinnedMode,
          strategy,
          }),
        CUTOFF_PROBE_TTL_MS,
      );

      cutoff = probed.cutoff;

      if (probed.keptIds) {
        // Cut by relevance, then let `sort` order whatever survived. Applying
        // the cut as a membership filter (rather than a score threshold) is
        // what keeps this coherent under sort=distance|name|organization,
        // where the returned hits are not in score order at all.
        baseFilters.push({ ids: { values: probed.keptIds } });
      }
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
      pinnedMode,
      sort,
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
      // Omitted entirely when the caller did not opt in, so the response
      // document is unchanged for every existing consumer.
      ...(cutoff ? { relevance_cutoff: cutoff } : {}),
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

  /**
   * Builds the exact / starts-with / phrase tier for one name surface.
   * All clauses target `.lc` (keyword, lowercase normalizer) or `.clean`
   * (tokenized, lowercase+asciifolding only — no stem/stop/synonym), never
   * the analyzed root field, so proper nouns aren't corrupted by stemming.
   *
   * `includeEdge`  – true only for top-level `name` (edge-ngram sub-field).
   * `includePhrase` – enables mid-string phrase matching on `.clean`
   *   (match_phrase + match_phrase_prefix). Suppress for single-token org
   *   queries to avoid noisy mid-field token hits ("health" → every
   *   "X Health Center").
   */
  private buildNameTierClauses(
    field: string,
    boost: number,
    queryStr: string,
    opts: { includePhrase: boolean; includeEdge?: boolean },
  ): QueryDslQueryContainer[] {
    const queryLower = queryStr.toLowerCase();
    const clauses: QueryDslQueryContainer[] = [
      { term: { [`${field}.lc`]: { value: queryLower, boost } } },
      { prefix: { [`${field}.lc`]: { value: queryLower, boost } } },
    ];
    if (opts.includeEdge) {
      clauses.push({
        match: { [`${field}.edge`]: { query: queryStr, boost } },
      });
    }
    if (opts.includePhrase) {
      clauses.push({
        match_phrase: { [`${field}.clean`]: { query: queryStr, boost } },
      });
      clauses.push({
        match_phrase_prefix: { [`${field}.clean`]: { query: queryStr, boost } },
      });
    }
    return clauses;
  }

  private buildLexicalShouldClauses(
    queryStr: string,
  ): QueryDslQueryContainer[] {
    // Phrase clauses on org name are noisy for single-token queries: "health"
    // would match every "X Health Center" even when its services are unrelated.
    // Exact + prefix on .lc are anchored to the start of the org name field and
    // are safe — single-token "rainbow" still finds "Rainbow House". Phrase
    // matching is enabled only for multi-token queries ("salvation army",
    // "american red cross of greater chicago").
    const isMultiToken =
      queryStr.trim().split(/\s+/).filter(Boolean).length >= 2;

    // organization.name is handled exclusively via the name tier below
    // (phrase/exact/prefix on .clean/.lc). organization.description is
    // mission-statement prose that matches unrelated need tokens — both are
    // excluded from the recall fallback so they don't leak noise at token level.
    const generalFields = SearchUtilsService.FIELDS_TO_QUERY.filter(
      (f) => f !== 'organization.name' && f !== 'organization.description',
    );

    return [
      // Top-level name: highest signal — edge-ngram + phrase on .clean
      ...this.buildNameTierClauses('name', BM25_NAME_BOOST, queryStr, {
        includePhrase: true,
        includeEdge: true,
      }),
      // Service name tier
      ...this.buildNameTierClauses(
        'service.name',
        BM25_SERVICE_NAME_BOOST,
        queryStr,
        { includePhrase: true },
      ),
      // Org name tier — phrase suppressed on single-token queries (see above)
      ...this.buildNameTierClauses(
        'organization.name',
        BM25_ORG_NAME_BOOST,
        queryStr,
        { includePhrase: isMultiToken },
      ),
      // General stemmed recall fallback on analyzed fields (low implicit boost)
      {
        multi_match: {
          operator: 'or',
          minimum_should_match: '2<75%',
          fields: generalFields,
          query: queryStr,
        },
      },
      // Nested taxonomy name/description boost
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
      // Nested taxonomy use_references (curated aliases) — dedicated higher
      // boost. "scouts" matches "Scouts"/"Girl Scouts"/"Scouting" on
      // PS-9800.8500 (Scouting Programs) and lifts it above generic hits.
      // score_mode: max so the best-matching alias entry drives the score.
      {
        nested: {
          path: 'taxonomies',
          query: {
            match: {
              'taxonomies.use_references': {
                query: queryStr,
                operator: 'or',
                minimum_should_match: '2<75%',
                boost: BM25_TAXONOMY_USE_REF_BOOST,
              },
            },
          },
          score_mode: 'max',
        },
      },
    ];
  }

  private buildScoreFunctions(
    queryVector: number[] | undefined,
    coords: number[] | undefined,
    distance: number,
  ): QueryDslFunctionScoreContainer[] {
    const functions: QueryDslFunctionScoreContainer[] = [];

    // NOTE: exact cosine runs over the full filtered population per query.
    // Fine under restrictive tenant+geo filters; for a broad tenant with no geo
    // filter it covers the whole index — candidate for a future knn pre-filter
    // or rescore window if tail latency becomes a concern.
    if (queryVector) {
      functions.push({
        script_score: {
          script: {
            // Math.max(0, ...) guards against negative cosine scores (which ES
            // rejects) without the +1.0 floor that was inflating every doc to
            // ~50–60 under boost_mode:sum and swamping the lexical name signal.
            source: "Math.max(0, cosineSimilarity(params.qv, 'embedding'))",
            params: { qv: queryVector },
          },
        },
        weight: VECTOR_SCORE_WEIGHT,
      });
    }

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

  /**
   * `sort` picks the order, the query still decides membership (ISS-1367).
   * pinned/priority lead only when `pinned_resources_mode` is `top`.
   */
  private buildHybridSort(
    sortOption: SearchResourcesQueryDto['sort'],
    coords: number[] | undefined,
    pinnedMode: PinnedResourcesMode,
  ): Sort {
    return SearchUtilsService.buildSortClause({
      fields: HYBRID_SORT_FIELDS,
      sortOption,
      coords,
      leadingTiers:
        pinnedMode === 'top' ? [{ pinned: 'desc' }, { priority: 'desc' }] : [],
    });
  }

  /**
   * Ranks the top candidates by **semantic and lexical relevance only** and
   * asks the detector where the cliff is.
   *
   * Geography is deliberately absent from this query, and that is the whole
   * point of running a separate pass rather than reading scores off the main
   * one. In the fused hybrid score, `gauss(distance)` spans a 0–25 range that
   * manufactures discontinuities out of *distance*, not relevance — so an
   * elbow found there cuts on geography. That fails in both directions: dense
   * geographies get spurious cuts at distance cliffs, and sparse ones get no
   * cut at all because every result is far and the range compresses.
   *
   * It is also wrong on the merits. Someone rural may well drive 40 miles for
   * the right resource; how far a person will travel is their decision, made
   * through `distance`/`geo_type`, and it is not evidence that a resource is
   * irrelevant. Proximity stays a ranking signal and a filter. It never
   * decides what gets cut.
   *
   * Pinned resources carry their boost here regardless of
   * `pinned_resources_mode`, so a tenant's curated resources rank high in the
   * probe and survive the cut.
   */
  /**
   * Locates a `relative_to_max` cut without a candidate window.
   *
   * The rule only needs two numbers — the top score, and how many results sit
   * above a fraction of it — and Elasticsearch answers both without collecting
   * documents. `size: 0` with `min_score` returns a count in about a
   * millisecond over a 27,000-result population, where fetching a 300-document
   * window costs ~250ms and still cannot see a cut that lands at 388.
   *
   * Documents are fetched only once the cut is known to be worth making, so the
   * expensive call is proportional to the cut rather than to a fixed window.
   *
   * `min_score` is inclusive, so a group of results tied exactly at the
   * threshold is kept or dropped whole. The tie-walk the sequence-based
   * detectors need has no equivalent here because the boundary cannot split.
   */
  private async probeRelativeToMax(
    index: string,
    query: QueryDslQueryContainer,
  ): Promise<{ keptIds: string[] | null; cutoff: RelevanceCutoffDto }> {
    // A private projection, not the response shape: the probe asks only for the
    // grouping key, so it must not borrow the public `SearchSource` DTO.
    type ProbeSource = { service_id?: string };
    const strategy = 'relative_to_max' as const;
    const { fraction, minKeep } = DEFAULT_RELATIVE_TO_MAX_OPTIONS;

    const head = await this.elasticsearchService.search<SearchSource>({
      index,
      size: 1,
      track_total_hits: true,
      _source: false,
      sort: ['_score'],
      query,
    });

    const matched =
      typeof head.hits.total === 'number'
        ? head.hits.total
        : (head.hits.total?.value ?? 0);
    const topScore = head.hits.hits[0]?._score ?? 0;

    const decline = (
      reason: RelevanceCutoffDto['reason'],
      examined: number,
    ): { keptIds: null; cutoff: RelevanceCutoffDto } => ({
      keptIds: null,
      cutoff: {
        strategy,
        applied: false,
        reason,
        kept: matched,
        matched_before_cutoff: matched,
        cutoff_score: null,
        candidates_examined: examined,
      },
    });

    if (matched <= minKeep) return decline('below_min_keep', matched);
    if (topScore <= 0) return decline('no_elbow', 1);

    const threshold = fraction * topScore;
    const counted = await this.elasticsearchService.search<SearchSource>({
      index,
      size: 0,
      track_total_hits: true,
      min_score: threshold,
      query,
    });
    const survivors =
      typeof counted.hits.total === 'number'
        ? counted.hits.total
        : (counted.hits.total?.value ?? 0);

    // Nothing meaningful scored below the threshold: the distribution is flat
    // and the honest answer is to return everything. This is the case a strict
    // fraction cannot express, and a lax one can.
    if (survivors >= matched * MIN_CUT_REDUCTION)
      return decline('no_elbow', matched);
    if (survivors > MAX_ENUMERATED_CUT)
      return decline('cut_too_large', survivors);

    const kept = await this.elasticsearchService.search<ProbeSource>({
      index,
      size: Math.max(survivors, 1),
      track_total_hits: false,
      min_score: threshold,
      _source: ['service_id'],
      sort: ['_score'],
      query,
    });

    let hits = kept.hits.hits;
    let cutoffScore = hits[hits.length - 1]?._score ?? null;
    const services = new Set(
      hits.map((h) => String(h._source?.service_id ?? h._id)),
    );

    // The floor is denominated in services, not documents: one provider's
    // branches must not fill every slot while other providers are cut.
    if (services.size < minKeep) {
      const widened = await this.elasticsearchService.search<ProbeSource>({
        index,
        size: SERVICE_FLOOR_WINDOW,
        track_total_hits: false,
        _source: ['service_id'],
        sort: ['_score'],
        query,
      });
      const seen = new Set<string>();
      const take: typeof widened.hits.hits = [];
      for (const hit of widened.hits.hits) {
        seen.add(String(hit._source?.service_id ?? hit._id));
        take.push(hit);
        if (seen.size >= minKeep) break;
      }
      if (take.length >= matched) return decline('below_min_keep', matched);
      hits = take;
      cutoffScore = take[take.length - 1]?._score ?? null;
    }

    const keptIds = hits
      .map((h) => h._id)
      .filter((id): id is string => typeof id === 'string');

    if (keptIds.length === 0 || keptIds.length >= matched)
      return decline('no_elbow', matched);

    return {
      keptIds,
      cutoff: {
        strategy,
        applied: true,
        reason: null,
        kept: keptIds.length,
        matched_before_cutoff: matched,
        cutoff_score: cutoffScore,
        candidates_examined: survivors,
      },
    };
  }

  private async probeRelevanceCutoff(args: {
    index: string;
    queryStr: string;
    queryVector: number[] | undefined;
    predicted: PredictedTaxonomy[];
    filters: QueryDslQueryContainer[];
    pinnedMode: PinnedResourcesMode;
    strategy: Exclude<RelevanceCutoffStrategy, 'off'>;
  }): Promise<{ keptIds: string[] | null; cutoff: RelevanceCutoffDto }> {
    const { index, queryStr, queryVector, predicted, filters, pinnedMode } =
      args;

    const should = [
      ...(queryStr ? this.buildLexicalShouldClauses(queryStr) : []),
      ...this.buildTaxonomyBoostClauses(predicted),
      ...(pinnedMode === 'ignore'
        ? []
        : [
            {
              constant_score: {
                filter: { term: { pinned: true } },
                boost: PINNED_SCORE_BOOST,
              },
            } as QueryDslQueryContainer,
          ]),
    ];

    // coords omitted on purpose — see the doc comment above.
    const scoreFunctions = this.buildScoreFunctions(queryVector, undefined, 0);

    const innerBool: QueryDslQueryContainer = {
      bool: { minimum_should_match: 0, filter: filters, should },
    };

    const probeQuery: QueryDslQueryContainer =
      scoreFunctions.length > 0
        ? {
            function_score: {
              query: innerBool,
              functions: scoreFunctions,
              score_mode: 'sum',
              boost_mode: 'sum',
            },
          }
        : innerBool;

    if (args.strategy === 'relative_to_max') {
      return this.probeRelativeToMax(index, probeQuery);
    }

    const probe = await this.elasticsearchService.search<SearchSource>({
      index,
      from: 0,
      size: CUTOFF_CANDIDATE_CEILING,
      track_total_hits: true,
      _source: false,
      sort: ['_score'],
      query:
        scoreFunctions.length > 0
          ? {
              function_score: {
                query: innerBool,
                functions: scoreFunctions,
                score_mode: 'sum',
                boost_mode: 'sum',
              },
            }
          : innerBool,
    });

    const candidates = probe.hits.hits ?? [];
    const scores = candidates.map((hit) => hit._score ?? 0);
    const matched =
      typeof probe.hits.total === 'number'
        ? probe.hits.total
        : (probe.hits.total?.value ?? 0);

    const decision =
      args.strategy === 'score_gap'
        ? detectScoreGapCutoff(scores, DEFAULT_SCORE_GAP_OPTIONS)
        : detectRelativeToMaxCutoff(scores, DEFAULT_RELATIVE_TO_MAX_OPTIONS);

    const truncated = matched > candidates.length;

    if (decision.keep === null) {
      return {
        keptIds: null,
        cutoff: {
          strategy: args.strategy,
          applied: false,
          // "Could not see far enough to decide" is not the same answer as
          // "looked, and there was nothing to cut".
          reason: truncated ? 'candidate_ceiling' : decision.reason,
          kept: matched,
          matched_before_cutoff: matched,
          cutoff_score: null,
          candidates_examined: candidates.length,
        },
      };
    }

    const keptIds = candidates
      .slice(0, decision.keep)
      .map((hit) => hit._id)
      .filter((id): id is string => typeof id === 'string');

    return {
      keptIds,
      cutoff: {
        strategy: args.strategy,
        applied: true,
        reason: null,
        kept: keptIds.length,
        matched_before_cutoff: matched,
        cutoff_score: decision.cutoffScore,
        candidates_examined: candidates.length,
      },
    };
  }

  private buildHybridQuery(args: {
    index: string;
    queryStr: string;
    queryVector: number[] | undefined;
    predicted: PredictedTaxonomy[];
    filters: QueryDslQueryContainer[];
    coords: number[] | undefined;
    distance: number;
    page: number;
    limit: number;
    aggs: Aggregations;
    pinnedMode: PinnedResourcesMode;
    sort: SearchResourcesQueryDto['sort'];
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
      pinnedMode,
      sort: sortOption,
    } = args;

    // Browse mode (empty query): omit lexical should clauses; filters + vector +
    // geo + taxonomy boosts still produce a valid ranked, counted, paginated set.
    const lexicalShould = queryStr
      ? this.buildLexicalShouldClauses(queryStr)
      : [];
    const taxonomyShould = this.buildTaxonomyBoostClauses(predicted);
    // When pinned_resources_mode is `boost`, pinned becomes a small additive
    // score contribution (constant_score) instead of a hard sort tier. When it
    // is `top`, the hard sort tiers handle ordering. When `ignore`, neither is
    // applied.

    this.logger.debug(`Pinned resources mode: ${pinnedMode}`);

    const pinnedShould: QueryDslQueryContainer[] =
      pinnedMode === 'boost'
        ? [
            {
              constant_score: {
                filter: { term: { pinned: true } },
                boost: PINNED_SCORE_BOOST,
              },
            },
          ]
        : [];
    const should = [...lexicalShould, ...taxonomyShould, ...pinnedShould];

    const sort = this.buildHybridSort(sortOption, coords, pinnedMode);

    const scoreFunctions = this.buildScoreFunctions(
      queryVector,
      coords,
      distance,
    );

    if (pinnedMode === 'boost') {
      // priority (integer, higher = more important) as a small score boost.
      scoreFunctions.push({
        field_value_factor: {
          field: 'priority',
          factor: PRIORITY_SCORE_WEIGHT,
          modifier: 'none',
          missing: 0,
        },
      });
    }

    // When there are no scoring functions (browse with no coords and no vector),
    // emit a plain bool so ES doesn't receive an empty function_score.
    const innerBool: QueryDslQueryContainer = {
      bool: {
        // Intentional: filters define the matched population; should clauses
        // and functions only rank. Do NOT set to 1.
        minimum_should_match: 0,
        filter: filters,
        should,
      },
    };

    const esQuery: QueryDslQueryContainer =
      scoreFunctions.length > 0
        ? {
            function_score: {
              query: innerBool,
              functions: scoreFunctions,
              score_mode: 'sum',
              boost_mode: 'sum',
            },
          }
        : innerBool;

    return {
      index,
      from: (page - 1) * limit,
      size: limit,
      track_total_hits: true,
      _source: { excludes: ['embedding', 'service_area'] },
      aggs,
      query: esQuery,
      sort,
    };
  }

  private resolvePinnedResourcesMode(
    searchConfig: SearchConfigCache | undefined,
  ): PinnedResourcesMode {
    const mode = searchConfig?.pinned_resources_mode;
    const validModes: PinnedResourcesMode[] = ['ignore', 'boost', 'top'];
    return validModes.includes(mode as PinnedResourcesMode)
      ? (mode as PinnedResourcesMode)
      : 'boost';
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
