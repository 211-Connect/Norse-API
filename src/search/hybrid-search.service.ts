import type { Span } from '@opentelemetry/api';
import { withSpan } from 'src/common/tracing/with-span';
import { EmbeddingSide, raceEmbeddings } from './internal/embedding-race';
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
  SortCombinations,
} from '@elastic/elasticsearch/lib/api/types';
import { SearchResourcesQueryDto } from './dto/search-query.dto';
import { SearchResourcesBodyDto } from './dto/search-body.dto';
import { AreaFilter } from './internal/area/area-match';
import { HeadersDto } from '../common/dto/headers.dto';
import {
  SearchHit,
  SearchResponse,
  SearchSource,
} from './dto/search-response.dto';
import { HYBRID_SORT_FIELDS, SearchUtilsService } from './search-utils.service';
import { CUTOFFS } from 'src/v2/rules/config';
import { EmbeddingResponse, Aggregations } from './types';
import { TenantConfigService } from '../cms-config/tenant-config.service';
import { PinnedResourcesMode } from '../cms-config/types/search-config-cache';
import { RequestCacheService } from 'src/common/services/cache/request-cache.service';
import { hybridDocumentsCountCacheKey } from './internal/cache-key/hybrid-documents-count-cache-key';
import { envFlag } from 'src/common/config/configuration';
import { matchLocale } from 'src/common/locales';
import { shardPreference } from 'src/common/elasticsearch/shard-preference';
import {
  SearchIdentity,
  searchFingerprint,
} from './internal/search-fingerprint';
import { MetricsService } from 'src/metrics/metrics.service';
import { relevanceCutoffCacheKey } from './internal/cache-key/relevance-cutoff-cache-key';
import { RelevanceCutoffDto } from './dto/search-response.dto';
import {
  fuzzyFallbackFor,
  needsTypoClauses,
} from './internal/text-matching/fuzzy-match';
import {
  SUNE_ENRICHMENT_FIELDS,
  stripEnrichment,
} from './internal/enrichment-fields';
import { resolveHybridIndex as resolveTenantHybridIndex } from './internal/hybrid-index';
import {
  contentWords,
  idf,
  adjacentJoins,
  splitCandidates,
  WORD_RARITY_FIELDS,
} from './internal/text-matching/word-rarity';
import { assertQueryLength, describeQueryForLog } from './internal/query-log';
import { BoundedKeyRegistry } from './internal/cache-key/bounded-key-registry';
import { wordRarityCacheKey } from './internal/cache-key/word-rarity-cache-key';
import { reciprocalRankFusion } from './internal/ranking/rank-fusion';
import {
  PINNED_GATE_MAX_HITS,
  PINNED_GATE_TIER_BOOST,
  pinnedGateUsesQuery,
  selectGatedPinnedIds,
  v2RankingPinnedMode,
} from './internal/ranking/pinned-gate';
import { normalizeQueryText } from './internal/query-text';
import { queryEmbeddingCacheKey } from './internal/cache-key/query-embedding-cache-key';
import { packEmbedding, unpackEmbedding } from './internal/embedding-codec';
import { SEARCH_SOURCE_EXCLUDES } from './internal/response-fields';

// An embedding of a text never changes, so it can live long in the cache.
const DEFAULT_EMBEDDING_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Vector weight mirrors the old kNN boost; tune to shift lexical vs semantic balance.
// After switching to Math.max(0, cosine) the effective range is ~0–0.4 vs the old
// ~1.0–1.4 (+1.0 floor), so this is raised from 50 to 100. Re-tune empirically after deploy.
const VECTOR_SCORE_WEIGHT = 100;
// Base boost for a matched predicted taxonomy code; multiplied by the code's
// prediction (kNN cosine) score and a small rank-decay factor.
const BASE_TAXONOMY_BOOST = 50;
// Taxonomy boosts are a flat constant, but the BM25 they compete with is not:
// the recall clause sums weak token matches across ~15 fields, so a long
// natural-language query inflates lexical scores into the hundreds (Q7, 15
// tokens: lexical top ~450, taxonomy boost ~55 — invisible) while short
// queries keep the balance the boosts were tuned on. Scale the taxonomy boost
// by query length: 1–3 tokens keep the ×1 baseline, then one unit per ~3
// tokens, capped at 5. Measured sweep (2026-09-24, tenant-wide): at ×3–×5 a
// 15-token query's top-5 goes fully on-topic; 1–3-token queries are untouched
// by construction, and exact-name matching still dominates at ≤×5 (see the
// length-scale spec tests).
const TAXONOMY_BOOST_TOKENS_PER_UNIT = 3;
const TAXONOMY_BOOST_MAX_SCALE = 5;
// Additive weight of the proximity signal in the hybrid score. Tuned to 25 (see ISS-1367).
const GEO_GAUSS_WEIGHT = 25;
const GEO_DEFAULT_SCALE_MI = 5;
// v2 only. A service with no map point (a virtual service, a hotline) scores
// as if it sat this many scales from the search point (1 = at the scale:
// 5 mi by default, else `distance`), so it ranks near the top but below
// services close by. Chosen from a sweep of real wa211 queries on 2026-11-18
// against fixed 3, 5, 10 and 15 miles (see docs/location-search.md).
export const VIRTUAL_DISTANCE_IN_SCALES = 1;
// Need boost (ISS-2745). Start values from the 2026-11-11 boost test: each need
// clause adds FRACTION x the top base score x the need score (K = fraction x top
// base score). The gate (0.97, Lucas's pick) is owned by the v2 rules config. Tier 1 needs boost at a smaller factor.
const NEED_BOOST_FRACTION = 0.1;
const NEED_BOOST_GATE = CUTOFFS.needs.use;
const NEED_BOOST_TIER1_FACTOR = 0.5;
// Urgency boost (ISS-2867): a used urgency lifts like one tier 2 need.
const URGENCY_BOOST_FACTOR = 1;

/**
 * The one check for a boostable urgency (David, PR #364): code U-1..U-4 and a
 * finite score above 0. U-0 comes only from the emergency check and has no
 * service weights. `urgencyBoostOf` (v2-search.service.ts) and the boost
 * builder in `searchHybrid` both call it.
 */
export function isBoostableUrgency(
  code: string,
  score: number,
): code is 'U-1' | 'U-2' | 'U-3' | 'U-4' {
  return /^U-[1-4]$/.test(code) && Number.isFinite(score) && score > 0;
}

/**
 * The distance score a service with no map point gets in v2: the gauss value
 * of a service VIRTUAL_DISTANCE_IN_SCALES scales away, 25 x 0.5^(k^2). With
 * k = 1 it is 12.5 at every scale.
 */
export function virtualDistanceWeight(): number {
  return GEO_GAUSS_WEIGHT * Math.pow(0.5, VIRTUAL_DISTANCE_IN_SCALES ** 2);
}

/**
 * One term of the boost list. `urgency` = the used urgency level, code
 * U-1..U-4, field `sune_urgency_weights`; the other tiers are needs, field
 * `sune_need_weights`.
 */
export type NeedScore = {
  code: string;
  tier: 'tier1' | 'tier2' | 'urgency';
  score: number;
};

/** The weights group a boost term reads. The one place that maps tier to field. */
const boostGroupOf = (n: NeedScore) =>
  n.tier === 'urgency' ? 'sune_urgency_weights' : 'sune_need_weights';
const boostFeatureField = (n: NeedScore): string =>
  `${boostGroupOf(n)}.${n.code}`;
const boostFactor = (n: NeedScore): number =>
  n.tier === 'tier1'
    ? NEED_BOOST_TIER1_FACTOR
    : n.tier === 'urgency'
      ? URGENCY_BOOST_FACTOR
      : 1;
export type RankingVersion = 'v1' | 'v2';

/**
 * The one match rule: a service carries a sent need when `sune_needs` holds
 * that exact code. Builds `m`, the sent codes the service carries, in sent
 * order. Missing field (index not tagged yet) = none. The block sort and the
 * `matched_needs` script field both start with this text.
 */
const NEED_MATCH_PAINLESS =
  'def m = new ArrayList(); ' +
  "if (doc.containsKey('sune_needs')) { def have = doc['sune_needs']; " +
  'for (def c : params.codes) { if (have.contains(c)) { m.add(c); } } }';

/** Painless: 2 = carries every sent need, 1 = some, 0 = none. */
export const NEED_BLOCK_SCRIPT =
  NEED_MATCH_PAINLESS +
  ' return m.size() == params.codes.size() ? 2 : (m.size() > 0 ? 1 : 0);';

/** Painless: the sent codes this service carries, in sent order. */
export const MATCHED_NEEDS_SCRIPT = NEED_MATCH_PAINLESS + ' return m;';

/** Script field: reads doc values, so no `_source` tag is returned and scores do not change. */
export function buildMatchedNeedsField(codes: string[]) {
  return {
    script: { source: MATCHED_NEEDS_SCRIPT, params: { codes } },
  };
}

export function buildNeedBlockSort(codes: string[]): SortCombinations {
  return {
    _script: {
      type: 'number',
      order: 'desc',
      script: { source: NEED_BLOCK_SCRIPT, params: { codes } },
    },
  };
}

/**
 * Whether sent needs lead the order as a block tier. Under sort=distance with
 * coords the order is strict distance (Lucas 2026-11-19: closeness ranker only,
 * selected needs do not lead). matched_needs is still returned.
 */
export function needBlockLeads(
  selectedNeeds: string[] | undefined,
  sort: SearchResourcesQueryDto['sort'],
  coords: number[] | undefined,
): boolean {
  if (!selectedNeeds || selectedNeeds.length === 0) return false;
  return !(sort === 'distance' && !!coords && coords.length === 2);
}

export type HybridSearchResult = SearchResponse & {
  /** Present only when counts were asked for and the count succeeded. */
  needCounts?: Record<string, number>;
  /** v2 only, internal (never sent to callers). Present, and false, only when Elasticsearch sent a hits.total that cannot be read; hits.total.value is then 0. */
  totalCounted?: false;
  /**
   * v2 only: raw top scores of the RRF keyword and vector lists, the
   * weak-match judges (ISS-2796). Absent when the fused path did not run.
   * The v1 /search never fuses, so it never gets this field.
   */
  judges?: Judges;
};

/** Raw top `_score` of the RRF keyword list and of the RRF vector list; 0 when a list has no hit. */
export type Judges = { keyword_top: number; vector_top: number };

type RankedList = { ids: string[]; top: number };

type HybridSearchOptions = {
  headers: HeadersDto;
  query: SearchResourcesQueryDto;
  body?: SearchResourcesBodyDto;
  needScores?: NeedScore[];
  /**
   * v2 only. The used urgency (U-1..U-4) and its score. Boosts services tagged
   * with that level. Ignored unless URGENCY_BOOST_ENABLED is true (any case, no spaces).
   */
  urgencyBoost?: { code: 'U-1' | 'U-2' | 'U-3' | 'U-4'; score: number };
  /**
   * v2 only. Caller-sent need codes. They never filter. They order results in
   * blocks: every code first, then some, then none (Lucas 2026-11-12). Empty or
   * absent changes nothing.
   */
  selectedNeeds?: string[];
  /**
   * v2 only. Need codes to count: results per code, from a terms aggregation
   * on `sune_needs`, over the same filters as the results but without the
   * `needs=` filter. Every code is returned, 0 when the aggregation omits it.
   */
  countCodes?: string[];
  /**
   * v2 only. Hard filter used only for a weak-match pick (ISS-2796): the text
   * was weak, so the need tags decide. The `needs` parameter itself never
   * filters.
   */
  needFilter?: string[];
  /**
   * Internal switch, not a DTO field and not a query parameter. Set only by
   * the future /v2/search; today's /search never sets it, so it always runs
   * v1 (flat name edge match, approximate taxonomy knn).
   */
  rankingVersion?: RankingVersion;
  /**
   * v2 only. An embedding the caller already started with startEmbedding for
   * this same query text. When present, prepareHybridSearch awaits it instead
   * of embedding again. undefined result = lexical-only fallback.
   */
  queryVector?: Promise<number[] | undefined>;
  /** An area search, as `SearchService` settled it. */
  area?: AreaFilter;
  /**
   * v2 only. The handle from startEarlyRetrieval for these same options.
   * When present, searchHybrid reuses the work it started instead of starting
   * it again. Absent: nothing changes.
   */
  early?: EarlyRetrieval;
};

/**
 * Opaque handle to the classify-independent part of a hybrid search, started
 * early by startEarlyRetrieval. Pass it back in `HybridSearchOptions.early`.
 */
export interface EarlyRetrieval {
  readonly stage: Promise<unknown>;
}

/**
 * The ranked lists stage 1 starts before classify. `undefined` in a promise
 * means the request is not sent: no lexical clauses, no taxonomy clauses, or
 * (vector) no query vector, which counts as a failed vector list.
 */
export interface EarlyLists {
  keyword: Promise<RankedList | undefined>;
  vector: Promise<RankedList | undefined>;
  taxonomy: Promise<RankedList | undefined>;
}

const EMBEDDING_TIMEOUT_MS = 10_000;

// When a tenant sets `pinned_resources_mode` to `boost`, pinned/priority stop
// being hard sort tiers and become small score contributions instead (so a
// large pinned pool no longer floods the first pages). Tune these like the
// other weights.
const PINNED_SCORE_BOOST = 5;
const PRIORITY_SCORE_WEIGHT = 1;

/**
 * Reciprocal rank fusion (ISS-2766). `RRF_K` is the usual damping constant.
 * `RRF_LIST_SIZE` is the depth of each ranked list and of the fused order.
 * 100 is also the Elasticsearch `pinned` query limit on ids.
 */
const RRF_K = 60;
const RRF_LIST_SIZE = 100;
// Weight of the cosine tie-break inside the taxonomy list (taxonomy scores are 25+).
const RRF_TAXONOMY_TIE_BREAK = 0.001;
// Weight of the need list in the fusion. Not measured: IL211 had 0 need-tagged
// services on 2026-11-16.
const RRF_NEED_LIST_WEIGHT = 1;
// RRF weight of the near-you (proximity) list. Low on purpose: it restores
// locality without hiding a strong match that is far away (ISS-2796).
const RRF_PROXIMITY_RELEVANCE_WEIGHT = 0.5;
// Any sort value at or above this means the doc has no `location.point`.
const NO_POINT_METERS = 1e12;

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
 * Keep everything scoring at least this fraction of the top score.
 *
 * Lax on purpose. At 0.5 the cut landed inside the unscoped top 20 on 30 of 37
 * queries — it was removing results a labeller called relevant. At 0.2 that is
 * 4 of 30, and 19 of 20 query/tenant pairs return the unscoped top 20 complete.
 * The cut's job is to remove the tail that only matched on one weak signal, not
 * to second-guess the ranking.
 */
const CUTOFF_FRACTION_OF_MAX = 0.2;

/**
 * Smallest result set worth cutting down to.
 *
 * Denominated in services, not documents. The index is service-at-location, so
 * one service with N locations is N documents scoring near-identically and
 * ranking adjacently — every flat run in a real score sequence is exactly one
 * service. A floor of 5 documents was a floor of 2 choices on Santa Cruz
 * `substance abuse treatment`.
 */
const CUTOFF_MIN_KEEP_SERVICES = 5;

/**
 * Largest cut we will enumerate into an `ids` filter.
 *
 * The cut point is located with a `min_score` count rather than by walking a
 * candidate window, so it is not limited to the first 300 results
 * and routinely finds cuts beyond them — on Nebraska 211 the 0.2 threshold
 * survives at 388 documents of 27,452, which the window could never see. What
 * still has to be bounded is the id list handed to the main query, so beyond
 * this the response says `cut_too_large` rather than trimming partially.
 */
const MAX_ENUMERATED_CUT = 1000;

/**
 * The cut must never remove the probe's own top-N documents. Measured on the
 * 28-pair matrix (e2e/out/CUTOFF_IMPROVEMENTS.md rev 4): the 0.2 threshold
 * exceeded the probe's 20th score on exactly the three pairs where the cutoff
 * removed intended top-20 results (Washington/Iowa Q3, Santa Cruz Q4), and on
 * no other pair. Clamping the threshold to this score fixed all three with
 * kept sets of 20 documents — smaller than any rescue fraction.
 */
const CUTOFF_TOP_DOCS_FLOOR = 20;

/**
 * When the base fraction leaves more survivors than MAX_ENUMERATED_CUT, try
 * these fractions in order and apply the first that enumerates. Measured on
 * the eight `cut_too_large` pairs: each rung keeps recall@20 = 20/20, and
 * 0.5 enumerates on all eight. This is not a knee detector — no ≥30% drop
 * exists in the class (largest single-rank drop in ranks [50,1000] is
 * −1.5%…−23.0%); the rungs are fixed, explainable fractions ("within 2–5× of
 * the best match"), and the count only gates enumeration. If none fit,
 * decline with `cut_too_large` as today. Do not extend past 0.5 without
 * re-measuring recall@20 on the matrix.
 */
const CUTOFF_FRACTION_LADDER = [0.25, 0.3, 0.4, 0.5] as const;

/**
 * Size of the need-tagged head the v2 probe sends next to its base head. It
 * lists the highest-scoring documents that carry at least one active need
 * weight, so the probe can compute the boosted top-21 itself instead of
 * waiting for a separate own-top-score call. A tagged document ranked past
 * this window cannot enter the computed top 21 (a bounded approximation; the
 * window is far larger than the 21 ranks the cut reads).
 */
const CUTOFF_TAGGED_HEAD_SIZE = 100;

/**
 * Elasticsearch stores a rank_feature value with about 9 significant bits, so
 * the real boost can differ from the exact one by up to 2^-8 of itself. The
 * computed boosted score uses this as a lower bound: the clamp guarantees the
 * top 20 survive only if the computed 21st score never exceeds the real one.
 */
const RANK_FEATURE_PRECISION_LOSS = 2 ** -8;

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

// Word rarity moves slowly (corpus-wide document counts), so a day is fresh enough.
const WORD_RARITY_TTL_MS = 24 * 60 * 60 * 1000;

// At most this many per-word rarity entries per process; the oldest go first.
export const MAX_WORD_RARITY_CACHE_ENTRIES = 20000;

/**
 * `words`: idf weight per query content word. `splits`: run-together words
 * the index itself says are usually written as two words ("foodbank" ->
 * "food bank"), with the idf of the split phrase. `null` = unknown, keep the
 * flat name match. `{ words: {}, splits: [] }` = no content words, the name
 * edge tier adds nothing.
 */
type WordRarity = {
  words: Record<string, number>;
  splits: { word: string; phrase: string; idf: number }[];
  /**
   * Whether the keyword list carries the two typo clauses. False only when
   * every content word has more than TYPO_GATE_MAX_DOCS matching documents.
   */
  typoClauses: boolean;
} | null;

/** What one word contributes: its idf and its best split, if any. Cached per word. */
type WordRarityEntry = {
  idf: number;
  /** Tenant documents that match the word (general recall fields). */
  docs: number;
  split: { phrase: string; idf: number } | null;
};

const MAX_SPLIT_BUCKETS = 60;

/** Parses `V2_KEYWORD_LOCALES` (comma list). Unset or blank returns `null` (all locales). */
export function parseKeywordLocales(
  raw: string | undefined,
): Set<string> | null {
  const items = (raw ?? '')
    .split(',')
    .map((x) => x.trim().toLowerCase().replace(/_/g, '-'))
    .filter((x) => x.length > 0);
  // A malformed entry (`en es`, `en;es`) would match no locale and drop the
  // keyword leg everywhere; ignore it. A list with no valid entry means all.
  const valid = items.filter((x) => /^[a-z]{2,3}([-_][a-z0-9]{2,8})*$/.test(x));
  return valid.length > 0 ? new Set(valid) : null;
}

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
  private readonly embeddingLocalBaseUrl: string | undefined;
  private readonly needBoostEnabled: boolean;
  /** Locales whose v2 search keeps the keyword leg. `null` = all (today's behavior). */
  private readonly keywordLocales: Set<string> | null;
  private readonly urgencyBoostEnabled: boolean;
  private wordRarityKeys = new BoundedKeyRegistry(
    MAX_WORD_RARITY_CACHE_ENTRIES,
  );

  private readonly embeddingCacheEnabled: boolean;
  private readonly embeddingCacheTtlMs: number;

  constructor(
    private readonly elasticsearchService: ElasticsearchService,
    private readonly configService: ConfigService,
    private readonly tenantConfigService: TenantConfigService,
    private readonly requestCacheService: RequestCacheService,
    private readonly metrics: MetricsService,
  ) {
    this.embeddingBaseUrl =
      this.configService.get<string>('EMBEDDING_BASE_URL');
    this.embeddingModel = this.configService.get<string>('EMBEDDING_MODEL');
    this.runpodApiKey = this.configService.get<string>('RUNPOD_API_KEY');
    this.embeddingLocalBaseUrl =
      this.configService.get<string>('EMBEDDING_LOCAL_BASE_URL')?.trim() ||
      undefined;
    // On by default (ADR 0039 Decision 79, Lucas and David, 2026-11-18).
    // Only `false` turns it off. Only v2 passes needScores, so v1 is unchanged.
    this.needBoostEnabled = envFlag(
      this.configService.get<string>('NEED_BOOST_ENABLED'),
      true,
    );
    this.urgencyBoostEnabled = envFlag(
      this.configService.get<string>('URGENCY_BOOST_ENABLED'),
      false,
    );
    this.embeddingCacheEnabled = envFlag(
      this.configService.get<string>('EMBEDDING_CACHE_ENABLED'),
      true,
    );
    const ttl = Number(
      this.configService.get<string>('EMBEDDING_CACHE_TTL_MS'),
    );
    this.embeddingCacheTtlMs =
      Number.isInteger(ttl) && ttl > 0 ? ttl : DEFAULT_EMBEDDING_CACHE_TTL_MS;
    this.keywordLocales = parseKeywordLocales(
      this.configService.get<string>('V2_KEYWORD_LOCALES'),
    );
  }

  /**
   * Whether the v2 keyword leg runs for this locale. `V2_KEYWORD_LOCALES`
   * unset or empty keeps it on for every locale. When set (for example
   * `en,es,ru`), other locales run the vector leg only. A tag matches by its
   * full form or its primary subtag (`es-MX` matches `es`).
   */
  private keywordEnabledForLocale(lang: string): boolean {
    if (this.keywordLocales === null) return true;
    const locales = this.keywordLocales;
    return !!matchLocale(lang.trim(), (t) => (locales.has(t) ? t : undefined));
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
        // Resolved on a cache miss only: a cached count needs no index.
        const index = await this.resolveHybridIndex(tenantId, lang);
        const result = await this.metrics.observeDownstream(
          'elasticsearch',
          'hybrid_documents_count',
          () =>
            this.elasticsearchService.count({
              index,
              query: { bool: { filter } },
            }),
        );
        return result.count;
      } catch (error) {
        this.logger.warn(
          `Document count failed for tenant=${tenantId}: ${error.message}`,
        );
        return 0;
      }
    });
  }

  async searchHybrid(
    options: HybridSearchOptions,
  ): Promise<HybridSearchResult> {
    const {
      request,
      countRequest,
      tenantFacets,
      cutoff,
      lang,
      fused,
      judges,
      fusedOrder,
    } = await withSpan('hybrid.prepare', async (span) => {
      const prepared = await this.prepareHybridSearch(options, {
        rank: true,
        fuse: true,
      });
      span.setAttributes({
        'hybrid.fused': prepared.fused,
        'hybrid.cutoff': prepared.cutoff !== undefined,
        'hybrid.need_counts': prepared.countRequest !== undefined,
      });
      return prepared;
    });

    const needCountsPromise = countRequest
      ? this.runNeedCounts(countRequest, options.countCodes ?? [])
      : Promise.resolve(undefined);

    type Resp = Awaited<
      ReturnType<
        typeof this.elasticsearchService.search<
          SearchSource,
          Record<string, AggregationsStringTermsAggregate>
        >
      >
    >;
    const data: Resp = await this.metrics.observeDownstream(
      'elasticsearch',
      'hybrid_search',
      () =>
        this.elasticsearchService.search<
          SearchSource,
          Record<string, AggregationsStringTermsAggregate>
        >(request),
    );

    const needsSent = (options.selectedNeeds ?? []).length > 0;
    const blockTier = needBlockLeads(
      options.selectedNeeds,
      options.query.sort,
      options.query.coords,
    );
    const hits: SearchHit[] = (data.hits.hits ?? []).map((hit) => {
      const normalizedFacets = SearchUtilsService.normalizeDocFacets(
        hit._source,
        lang,
      );
      return {
        _index: hit._index,
        _id: hit._id,
        // A pinned query scores about 1.7e38, and a filter-only query 0:
        // neither means anything to a caller.
        _score: fused ? null : (hit._score ?? null),
        _source: stripEnrichment({
          ...hit._source,
          facets: normalizedFacets,
        }),
        // With needs sent, sort[0] is the internal block number. It stays server
        // side. A search ordered by the fused ranking sorts by the pinned score
        // (~1.7e38), so it has no sort to show. Name and distance keep theirs.
        ...(fusedOrder
          ? {}
          : {
              sort: (blockTier ? hit.sort?.slice(1) : hit.sort) as
                number[] | undefined,
            }),
        ...(needsSent
          ? { matched_needs: this.readMatchedNeeds(hit.fields) }
          : {}),
      };
    });

    const facets = SearchUtilsService.transformAggregations(
      tenantFacets,
      data.aggregations,
      lang,
    );

    const rawTotal: unknown = data.hits.total;
    const readTotal: number | null =
      typeof rawTotal === 'number' && Number.isFinite(rawTotal)
        ? rawTotal
        : typeof (rawTotal as { value?: unknown } | null | undefined)?.value ===
              'number' && Number.isFinite((rawTotal as { value: number }).value)
          ? (rawTotal as { value: number }).value
          : null;
    const totalHits = readTotal ?? 0;
    // v2 reads 0 as "no results" and drops needs questions, so an unreadable
    // total is flagged. The shape type is logged, never the value or query.
    const totalUnreadable =
      readTotal === null && options.rankingVersion === 'v2';
    if (totalUnreadable) {
      this.logger.warn(
        `hits.total unreadable (${rawTotal === null ? 'null' : typeof rawTotal}); treated as not counted`,
      );
    }

    const needCounts = await needCountsPromise;

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
          max_score: fused ? null : (hits[0]?._score ?? null),
          hits,
        },
      },
      facets,
      // Omitted entirely when the caller did not opt in, so the response
      // document is unchanged for every existing consumer.
      ...(cutoff ? { relevance_cutoff: cutoff } : {}),
      ...(needCounts ? { needCounts } : {}),
      ...(totalUnreadable ? { totalCounted: false as const } : {}),
      ...(judges ? { judges } : {}),
    };
  }

  private readMatchedNeeds(fields: unknown): string[] {
    const v = (fields as Record<string, unknown> | undefined)?.matched_needs;
    return Array.isArray(v) ? (v as string[]) : [];
  }

  /**
   * Counts per need code. A terms aggregation leaves out zero-count buckets,
   * so every requested code is written with 0 first. A failure returns
   * undefined, which the caller reads as "not counted" (never as all 0).
   */
  private async runNeedCounts(
    request: SearchRequest,
    codes: string[],
  ): Promise<Record<string, number> | undefined> {
    try {
      const data = await this.metrics.observeDownstream(
        'elasticsearch',
        'hybrid_need_counts',
        () =>
          this.elasticsearchService.search<
            unknown,
            Record<string, AggregationsStringTermsAggregate>
          >(request),
      );
      const buckets =
        (data.aggregations?.need_counts?.buckets as
          { key: string; doc_count: number }[] | undefined) ?? [];
      const counts: Record<string, number> = Object.fromEntries(
        codes.map((c) => [c, 0]),
      );
      for (const b of buckets) {
        if (b.key in counts) counts[b.key] = b.doc_count;
      }
      return counts;
    } catch (error) {
      this.logger.warn(`Need counts skipped: ${(error as Error).message}`);
      return undefined;
    }
  }

  /**
   * The request behind a map's pins: the same population as `searchHybrid`, but
   * unranked by default. Filters alone decide membership here, so embedding the
   * query and running exact cosine over the population would buy only the order
   * of a truncated set. `relevance_cutoff` does read scores, so it keeps them.
   */
  async buildPinsRequest(options: HybridSearchOptions): Promise<SearchRequest> {
    // v2 with text: the pins use the same kept set as the search page, so the
    // map shows what the list shows (plan rule 7). Everything else is unranked.
    const sameKeptSet =
      options.rankingVersion === 'v2' &&
      String(options.query.query ?? '').trim().length > 0;
    const { request } = await this.prepareHybridSearch(options, {
      rank: sameKeptSet || options.query.relevance_cutoff === 'on',
      fuse: sameKeptSet,
    });

    return request;
  }

  /**
   * Starts everything that does not depend on the classify result: the
   * embedding, tenant facets and search config, word rarity, the keyword,
   * vector and taxonomy lists, the stats request and the taxonomy lookup.
   * Each request starts as soon as its own inputs exist. Call it with the
   * options `searchHybrid` will get (needScores and countCodes may be left
   * out), then pass the handle back as `options.early`. Never throws and never
   * leaves an unhandled rejection: a failure reaches `searchHybrid`.
   */
  startEarlyRetrieval(options: HybridSearchOptions): EarlyRetrieval {
    const stage = withSpan('hybrid.early_start', () =>
      this.runClassifyIndependentStage(options, { rank: true, fuse: true }),
    );
    // The consumer is searchHybrid; this only prevents an unhandled rejection
    // if the request ends before it gets there.
    stage.catch(() => undefined);
    return { stage };
  }

  /**
   * Stage 1 of prepareHybridSearch: everything that depends only on the
   * request and the query vector, never on classify or the rules. The keyword
   * list starts when word rarity resolves, the vector list and the taxonomy
   * lookup when the embedding resolves, the taxonomy list when the lookup
   * resolves, and the stats request once facets and search config are in.
   */
  private async runClassifyIndependentStage(
    options: HybridSearchOptions,
    { rank, fuse }: { rank: boolean; fuse: boolean },
  ) {
    const { headers, query: q } = options;
    const {
      query,
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
    const v2 = options.rankingVersion === 'v2';
    const lang = headers['accept-language'] || 'en';
    // `V2_KEYWORD_LOCALES` (v2 only): a locale outside the list runs the vector leg only.
    const keywordLocale = !v2 || this.keywordEnabledForLocale(lang);
    const queryStr = typeof query === 'string' ? query : String(query);
    assertQueryLength(queryStr);
    const hardScopeCodes = q.taxonomy ?? [];

    const index = await this.resolveHybridIndex(tenantId, lang);
    const identity: SearchIdentity = {
      tenantId,
      lang,
      queryStr,
      filters,
      taxonomies: hardScopeCodes,
      coords,
      distance,
      age,
      geoType: geo_type,
      organizationId: organization_id,
      geometry,
      area: options.area,
    };
    const preference = shardPreference('hybrid', searchFingerprint(identity));

    this.logger.debug(
      `Hybrid search — tenant=${tenantId}, index=${index}, query: ${describeQueryForLog(queryStr)}`,
    );

    // Browse mode (empty query): skip embedding — many embedding servers 400 on
    // empty input, causing a 503. Filters + sort carry the result set; vector
    // scoring is simply omitted for browse.
    const wantsVector = rank && queryStr.trim().length > 0;

    // buildFilters keeps the existing geo semantics: service_area "contains" AND
    // (within `distance` of location.point OR no location.point). In proximity
    // mode there is no top-level "contains", and a listing with no point needs
    // its service_area to contain the search point instead (ISS-2755). A true
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
      options.area,
      v2 ? 'or-within-facet' : 'and',
    );
    baseFilters.unshift({ term: { tenant_id: tenantId } });
    // v2 weak-match pick only (ISS-2796, Lucas 2026-11-18): results, counts,
    // lists and pins all see this filter.
    if (options.needFilter && options.needFilter.length > 0) {
      baseFilters.splice(1, 0, {
        terms: { sune_needs: options.needFilter },
      });
    }

    if (hardScopeCodes.length > 0) {
      baseFilters.push(
        this.buildHardTaxonomyScopeFilter(hardScopeCodes, {
          includeChildren: v2,
        }),
      );
    }

    // Known before any await. With the cutoff on the lists wait for the cut's
    // `ids` filter, so nothing starts early.
    const cutoffRequested = (q.relevance_cutoff ?? 'off') === 'on';
    // The embedding is not a condition: a missing vector is a failed vector
    // list, and the other lists still fuse.
    const fuseEligible = this.shouldFuse({ fuse, v2, rank, queryStr });
    const startLists = fuseEligible && !cutoffRequested;

    const embedPromise: Promise<number[] | undefined> = wantsVector
      ? (options.queryVector ?? this.startEmbedding(queryStr))
      : Promise.resolve(undefined);
    const facetsPromise = this.tenantConfigService.getFacets(tenantId);
    const searchConfigPromise =
      this.tenantConfigService.getSearchConfig(tenantId);
    const wordRarityPromise: Promise<WordRarity> =
      v2 && wantsVector
        ? withSpan('hybrid.word_rarity', async (span) => {
            const rarity = await this.getWordRarity(
              index,
              tenantId,
              lang,
              queryStr,
              preference,
            );
            span.setAttribute(
              'hybrid.typo_clauses',
              rarity?.typoClauses ?? true,
            );
            return rarity;
          })
        : Promise.resolve(null);

    // The keyword list needs word rarity only, not the embedding.
    const keywordPromise: Promise<RankedList | undefined> | undefined =
      startLists
        ? wordRarityPromise.then((wordRarity) =>
            this.fetchKeywordList({
              index,
              preference,
              filters: [...baseFilters],
              queryStr,
              wordRarity,
              keyword: keywordLocale,
            }),
          )
        : undefined;
    // The vector list needs the embedding only, not word rarity.
    const vectorPromise: Promise<RankedList | undefined> | undefined =
      startLists
        ? embedPromise.then((queryVector) =>
            queryVector
              ? this.fetchVectorList({
                  index,
                  preference,
                  filters: [...baseFilters],
                  queryVector,
                })
              : undefined,
          )
        : undefined;
    // Taxonomy prediction requires a query vector; skip if embedding was
    // skipped (browse) or failed (lexical fallback). It needs the embedding
    // only, not facets, search config or word rarity.
    const taxonomyStart = embedPromise.then(async (queryVector) => ({
      queryVector,
      predicted: queryVector
        ? await this.getTaxonomyCodes(queryVector, tenantId, preference, v2)
        : [],
    }));
    const taxonomyPromise: Promise<RankedList | undefined> | undefined =
      startLists
        ? taxonomyStart.then(({ queryVector, predicted }) =>
            queryVector
              ? this.fetchTaxonomyList({
                  index,
                  preference,
                  filters: [...baseFilters],
                  queryStr,
                  queryVector,
                  predicted,
                })
              : undefined,
          )
        : undefined;
    // The stage or fetchFusedOrder handles a rejection. These side branches
    // only keep a request that nobody awaits from being reported as unhandled,
    // for example when the embedding fails after the keyword list started.
    for (const early of [
      keywordPromise,
      vectorPromise,
      taxonomyPromise,
      taxonomyStart,
    ]) {
      early?.catch(() => undefined);
    }

    const [queryVector, tenantFacets, searchConfig, wordRarity] =
      await Promise.all([
        embedPromise,
        facetsPromise,
        searchConfigPromise,
        wordRarityPromise,
      ]);
    // The vector leg is the only signal left when the keyword leg is off for
    // this locale; if the embedding failed, the keyword leg runs after all.
    const keyword = keywordLocale || queryVector === undefined;

    const pinnedMode =
      SearchUtilsService.resolvePinnedResourcesMode(searchConfig);
    // v2 with a query: no pinned bonus anywhere in the ranking; the gate below
    // decides which pinned services lead (Lucas 2026-11-18). v1 and browse keep pinnedMode.
    const gateByQuery = pinnedGateUsesQuery({ v2, rank, queryStr });
    // v2 ranked requests treat boost and top as one state (v2RankingPinnedMode).
    const rankingPinnedMode: PinnedResourcesMode =
      v2 && rank
        ? v2RankingPinnedMode({ mode: pinnedMode, queryStr, sort })
        : gateByQuery
          ? 'ignore'
          : pinnedMode;
    const gateActive =
      gateByQuery &&
      pinnedMode !== 'ignore' &&
      (sort ?? 'relevance') === 'relevance';

    // Handed to fetchFusedOrder, which awaits the original promises: a failed
    // list is logged and the surviving lists fuse.
    const earlyLists: EarlyLists | undefined =
      fuseEligible && !cutoffRequested
        ? {
            // The early keyword list honored the locale switch; when the
            // embedding then failed, the keyword leg runs after all here too.
            keyword:
              keyword && !keywordLocale
                ? this.fetchKeywordList({
                    index,
                    preference,
                    filters: [...baseFilters],
                    queryStr,
                    wordRarity,
                    keyword: true,
                  })
                : keywordPromise!,
            vector: vectorPromise!,
            taxonomy: taxonomyPromise!,
          }
        : undefined;

    const aggs = SearchUtilsService.buildFacetAggregations(tenantFacets, lang);
    const { predicted: predictedTaxonomies } = await taxonomyStart;

    this.logger.log(
      `[Hybrid search] - query: ${describeQueryForLog(queryStr)} | predicted codes: [${predictedTaxonomies
        .map((t) => t.code)
        .join(', ')}] | names: [${predictedTaxonomies
        .map((t) => t.name)
        .join(', ')}]`,
    );

    return {
      v2,
      lang,
      queryStr,
      index,
      preference,
      identity,
      wantsVector,
      queryVector,
      tenantFacets,
      pinnedMode,
      rankingPinnedMode,
      gateActive,
      wordRarity,
      keyword,
      cutoffRequested,
      fuseEligible,
      baseFilters,
      earlyLists,
      aggs,
      predictedTaxonomies,
    };
  }

  private async prepareHybridSearch(
    options: HybridSearchOptions,
    { rank, fuse }: { rank: boolean; fuse: boolean },
  ) {
    const stage1 = options.early
      ? ((await options.early.stage) as Awaited<
          ReturnType<typeof this.runClassifyIndependentStage>
        >)
      : await this.runClassifyIndependentStage(options, { rank, fuse });
    const {
      v2,
      lang,
      queryStr,
      index,
      preference,
      identity,
      wantsVector,
      queryVector,
      tenantFacets,
      pinnedMode,
      rankingPinnedMode,
      gateActive,
      wordRarity,
      keyword,
      cutoffRequested,
      fuseEligible,
      earlyLists,
      aggs,
      predictedTaxonomies,
    } = stage1;
    const baseFilters = [...stage1.baseFilters];
    const { query: q } = options;
    const { page, limit, coords, distance, sort } = q;

    // Stage 2: everything below depends on needScores, the cutoff probe or the
    // selected needs.
    const activeNeeds = (options.needScores ?? []).filter(
      (n) =>
        (n.tier === 'tier1' || n.tier === 'tier2') &&
        n.code !== 'N-X' &&
        n.score >= NEED_BOOST_GATE,
    );
    const { urgencyBoost } = options;
    const urgencyTerms: NeedScore[] =
      this.urgencyBoostEnabled &&
      urgencyBoost &&
      isBoostableUrgency(urgencyBoost.code, urgencyBoost.score)
        ? [
            {
              code: urgencyBoost.code,
              tier: 'urgency',
              score: urgencyBoost.score,
            },
          ]
        : [];
    const boostTerms = [
      ...(this.needBoostEnabled ? activeNeeds : []),
      ...urgencyTerms,
    ];
    const boostActive = rank && boostTerms.length > 0;

    // Opt-in only (ISS-1752). With `relevance_cutoff` absent or `off` nothing
    // below runs, no extra Elasticsearch call is made, and the request built
    // further down is identical to what it has always been.
    let cutoff: RelevanceCutoffDto | undefined;

    // Need boost (ISS-2745). Runs only with the switch on, a ranked request and
    // at least one need at or above the gate; otherwise nothing below runs and
    // the request is unchanged.

    // The same inputs for every need-boost top-score request below.
    const needBoostTopScore = (): Promise<number> =>
      this.fetchNeedBoostTopScore({
        index,
        preference,
        queryStr,
        queryVector,
        predicted: predictedTaxonomies,
        filters: [...baseFilters],
        coords,
        distance: distance ?? 0,
        pinnedMode: rankingPinnedMode,
        wordRarity,
        keyword,
        v2,
      });
    // v2 with the cutoff and the boost both active: the cut happens after the
    // boost (ADR 0039, option A). The probe sizes its own boost, so the main
    // search's top-score call no longer needs the cut's ids and starts now, in
    // parallel with the probe's own top-score call. v1 keeps its old order.
    const boostTopScorePromise =
      cutoffRequested && v2 && boostActive ? needBoostTopScore() : undefined;
    const probeNeeds =
      boostTopScorePromise !== undefined ? boostTerms : undefined;

    if (cutoffRequested) {
      const cacheKey = relevanceCutoffCacheKey({
        ...identity,
        pinnedMode,
        rankingVersion: v2 ? 'v2' : 'v1',
        needs: probeNeeds,
      });

      const runProbe = () =>
        withSpan('hybrid.cutoff_probe', () =>
          this.probeRelevanceCutoff({
            index,
            preference,
            queryStr,
            queryVector,
            predicted: predictedTaxonomies,
            filters: baseFilters,
            pinnedMode,
            wordRarity,
            keyword,
            needs: probeNeeds,
          }),
        );

      // Cached so pages 2..n of one search reuse a single probe rather than
      // re-running it — and so the kept set cannot drift between pages. A v2
      // probe scored after a failed rarity lookup (null) is flat; caching it
      // would cut later pages, whose lookup succeeds, with that flat probe.
      const rarityFailed = v2 && wantsVector && wordRarity === null;
      const probed = rarityFailed
        ? await runProbe()
        : await this.requestCacheService.getOrSet(
            cacheKey,
            runProbe,
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

    // v2 sort=distance with a search point: nearest first. A service with no
    // map point (virtual, hotline) is not hidden (Lucas 2026-11-23, David on
    // PR #364, ADR 0039 Decision 83). Its sort value is Infinity, so it ranks
    // at the fixed distance after every service with a point; the summed path
    // gives the same service `virtualDistanceWeight()`. Nothing is filtered, so
    // the counts and the page total agree.
    const distanceWithPoint =
      v2 && sort === 'distance' && coords !== undefined && coords.length === 2;
    // The kept set is ordered by the fused ranking when the sort is relevance,
    // or distance without a point (it falls back to relevance).
    const orderedByFusion =
      (sort ?? 'relevance') === 'relevance' ||
      (sort === 'distance' && !distanceWithPoint);
    // Near-you list: sort relevance with a point and no area (plan rule 2).
    const nearYou =
      (sort ?? 'relevance') === 'relevance' &&
      coords !== undefined &&
      coords.length === 2 &&
      !options.area?.regionIds.length;

    // v2 pinned gate: starts here, after the cut's ids filter, and runs in
    // parallel with the need-boost top score and the fused order.
    const gatePromise: Promise<string[]> = gateActive
      ? this.fetchPinnedGate({
          index,
          preference,
          queryStr,
          queryVector,
          predicted: predictedTaxonomies,
          filters: [...baseFilters],
          wordRarity,
          keyword,
        })
      : Promise.resolve([]);

    let needShould: QueryDslQueryContainer[] = [];

    if (boostTopScorePromise) {
      // Already started before the cutoff probe (v2, cutoff on).
      const topScore = await boostTopScorePromise;
      if (topScore > 0) {
        needShould = this.buildNeedBoostClauses(boostTerms, topScore);
      }
    } else if (boostActive && !(fuseEligible && !cutoffRequested)) {
      // Fused with the cutoff off: the need list replaces the boost and the
      // top-score request is not sent. The organic tail after the fused top
      // 100 then has no need boost. If the fusion fails, the block after the
      // fusion call restores today's boost.
      const topScore = await needBoostTopScore();
      if (topScore > 0) {
        needShould = this.buildNeedBoostClauses(boostTerms, topScore);
      }
    }

    let fusedIds: string[] | undefined;
    let judges: Judges | undefined;
    if (fuseEligible) {
      // `baseFilters` already holds the relevance-cutoff `ids` filter when the
      // cutoff ran, so the lists only see kept services. The cutoff decides
      // membership from today's scores; fusion only orders.
      const fusedOrder = await withSpan('hybrid.fused_order', () =>
        this.fetchFusedOrder({
          index,
          preference,
          filters: baseFilters,
          queryStr,
          queryVector,
          predicted: predictedTaxonomies,
          wordRarity,
          keyword,
          needs: boostActive ? boostTerms : [],
          earlyLists,
          coords,
          nearYou,
        }),
      );
      fusedIds = fusedOrder.ids;
      // The weak-match test needs the keyword judge; without it no weak match.
      judges = keyword ? fusedOrder.judges : undefined;

      if (fusedIds === undefined && boostActive && !cutoffRequested) {
        // Fusion failed after the top-score request was skipped: fall back
        // to today's summed ranking, need boost included.
        const topScore = await needBoostTopScore();
        if (topScore > 0) {
          needShould = this.buildNeedBoostClauses(boostTerms, topScore);
        }
      }
    }

    const gatedPinnedIds = await gatePromise;
    if (gatedPinnedIds.length > 0 && fusedIds !== undefined) {
      const gated = new Set(gatedPinnedIds);
      fusedIds = [
        ...gatedPinnedIds,
        ...fusedIds.filter((id) => !gated.has(id)),
      ].slice(0, RRF_LIST_SIZE);
    }

    const request = this.buildHybridQuery({
      index,
      preference,
      queryStr,
      queryVector,
      predicted: predictedTaxonomies,
      filters: baseFilters,
      coords,
      distance: distance ?? 0,
      page,
      limit: limit || 25,
      aggs,
      pinnedMode: rankingPinnedMode,
      sort,
      extraShould: needShould,
      wordRarity,
      keyword,
      fusedIds,
      orderedByFusion,
      gatedPinnedIds: fusedIds === undefined ? gatedPinnedIds : [],
      selectedNeeds: [...new Set(options.selectedNeeds ?? [])],
      v2,
    });

    const countCodes = options.countCodes ?? [];
    const countRequest: SearchRequest | undefined =
      countCodes.length > 0
        ? {
            index,
            preference,
            size: 0,
            track_total_hits: false,
            // Filters alone define the matched population (should clauses only
            // rank), so a plain filter query counts the same set. Built after
            // the relevance cut, so it counts the cut population: option
            // results_count and the result total stay comparable in finalize.
            // With a kept set (fusion), the same ids as the page. Under
            // sort=distance with coords the count does NOT hide services with
            // no map point (Lucas 2026-11-23): an option count can be above
            // the page total there, by design.
            query: {
              bool: {
                filter: [
                  ...baseFilters,
                  ...(fusedIds ? [{ ids: { values: fusedIds } }] : []),
                ],
              },
            },
            aggs: {
              need_counts: {
                terms: {
                  field: 'sune_needs',
                  include: countCodes,
                  size: countCodes.length,
                },
              },
            },
          }
        : undefined;

    return {
      request,
      countRequest,
      tenantFacets,
      cutoff,
      lang,
      fused: fusedIds !== undefined,
      // The page is in the fused order (pinned query): no sort values to show.
      fusedOrder: fusedIds !== undefined && orderedByFusion,
      judges,
    };
  }

  private hybridSourceExcludes() {
    return {
      excludes: SEARCH_SOURCE_EXCLUDES,
    };
  }

  /**
   * Whether the search fuses ranked lists into a kept set (ISS-2766, simple
   * location model 2026-11-23). Every v2 text query fuses, under every sort,
   * with or without coords. Each condition has a reason:
   * - `fuse`: only the ranked search page and its pins fuse.
   * - `v2`: v1 must not change at all.
   * - `rank`: an unranked request has no scores to order.
   * - non-empty query: browse mode has no keyword or vector signal.
   * - not a condition: the embedding (a missing vector is a failed vector
   *   list, the other lists still fuse), `coords` and `sort` (the sort only
   *   re-orders the kept set), and the need boost (the need list replaces it).
   */
  private shouldFuse(args: {
    fuse: boolean;
    v2: boolean;
    rank: boolean;
    queryStr: string;
  }): boolean {
    const { fuse, v2, rank, queryStr } = args;
    return fuse && v2 && rank && queryStr.trim().length > 0;
  }

  /**
   * The keyword list, the top `RRF_LIST_SIZE` ids, with the same clauses as
   * the main query. Returns undefined, and sends nothing, when the query has
   * no lexical clauses. Rejects when the request fails; `fetchFusedOrder`
   * handles that.
   */
  private fetchKeywordList(args: {
    index: string;
    preference: string;
    filters: QueryDslQueryContainer[];
    queryStr: string;
    wordRarity: WordRarity;
    keyword: boolean;
  }): Promise<RankedList> | undefined {
    const { filters, queryStr, wordRarity, keyword } = args;
    const lexical = keyword
      ? this.buildLexicalShouldClauses(queryStr, wordRarity)
      : [];
    if (lexical.length === 0) return undefined;
    return this.runRankedList(args, 'hybrid_rrf_keyword', {
      bool: { filter: filters, should: lexical, minimum_should_match: 1 },
    });
  }

  /** The vector list: cosine similarity to the query vector. Rejects like the keyword list. */
  private fetchVectorList(args: {
    index: string;
    preference: string;
    filters: QueryDslQueryContainer[];
    queryVector: number[];
  }): Promise<RankedList> {
    const { filters, queryVector } = args;
    return this.runRankedList(args, 'hybrid_rrf_vector', {
      script_score: {
        query: { bool: { filter: filters } },
        script: {
          source: "Math.max(0, cosineSimilarity(params.qv, 'embedding'))",
          params: { qv: queryVector },
        },
      },
    });
  }

  /**
   * The taxonomy list. Returns undefined, and sends nothing, when the
   * predicted codes give no boost clauses. Rejects like the keyword list.
   */
  private fetchTaxonomyList(args: {
    index: string;
    preference: string;
    filters: QueryDslQueryContainer[];
    queryStr: string;
    queryVector: number[];
    predicted: PredictedTaxonomy[];
  }): Promise<RankedList> | undefined {
    const { filters, queryStr, queryVector, predicted } = args;
    const taxonomy = this.buildTaxonomyBoostClauses(predicted, queryStr);
    if (taxonomy.length === 0) return undefined;
    // Many services carry the same predicted code and tie on the
    // taxonomy score, so Elasticsearch would break the tie in index
    // order. A tiny cosine term breaks it by meaning instead, as the
    // ranking lab did (live check 2026-11-16: top-10 overlap with the
    // lab order was 0.71 without it).
    return this.runRankedList(args, 'hybrid_rrf_taxonomy', {
      script_score: {
        query: {
          bool: {
            filter: filters,
            should: taxonomy,
            minimum_should_match: 1,
          },
        },
        script: {
          source: `_score + ${RRF_TAXONOMY_TIE_BREAK} * Math.max(0, cosineSimilarity(params.qv, 'embedding'))`,
          params: { qv: queryVector },
        },
      },
    });
  }

  private runRankedList(
    args: { index: string; preference: string },
    name: string,
    query: QueryDslQueryContainer,
  ): Promise<RankedList> {
    return this.metrics
      .observeDownstream('elasticsearch', name, () =>
        this.elasticsearchService.search({
          index: args.index,
          preference: args.preference,
          size: RRF_LIST_SIZE,
          _source: false,
          track_total_hits: false,
          query,
        }),
      )
      .then((response) => ({
        ids: response.hits.hits
          .map((h) => h._id)
          .filter((id): id is string => id !== undefined),
        // Raw score of the first hit: the weak-match judge (ISS-2796).
        top: response.hits.hits[0]?._score ?? 0,
      }));
  }

  /**
   * Ranked lists (keyword, vector, taxonomy, and a need list when needs are
   * active), each the top `RRF_LIST_SIZE` ids, fused by reciprocal rank. The
   * fused top `RRF_LIST_SIZE` ids are the kept set. A failed list is logged
   * and the surviving lists fuse; no query vector counts as a failed vector
   * list. Judges (ISS-2796) come back only when the keyword and the vector
   * list both succeeded. With `nearYou`, a proximity list (`runProximityList`)
   * re-orders the kept set at `RRF_PROXIMITY_RELEVANCE_WEIGHT`; membership never
   * changes, and a failed or empty proximity list keeps the relevance order.
   * `pinned_resources_mode` `boost` (+5 constant) and the priority function
   * are not in the lists. Mode `top` still works: its sort tiers come before
   * `_score`. `earlyLists` holds the keyword, vector and taxonomy lists when
   * stage 1 already started them; then this method sends only the need list.
   * Otherwise it sends all of them through the same list methods.
   * Plain `search`, not `msearch`: the read-only Elasticsearch guard rejects
   * `_msearch`. Never rejects: when every list failed (or the fusion is
   * empty) the search keeps today's summed ranking.
   */
  private async fetchFusedOrder(args: {
    index: string;
    preference: string;
    filters: QueryDslQueryContainer[];
    queryStr: string;
    queryVector: number[] | undefined;
    predicted: PredictedTaxonomy[];
    wordRarity: WordRarity;
    keyword: boolean;
    needs: NeedScore[];
    earlyLists?: EarlyLists;
    coords: number[] | undefined;
    nearYou: boolean;
  }): Promise<{ ids?: string[]; judges?: Judges }> {
    const { filters, needs, earlyLists, queryVector } = args;

    try {
      const keyword = earlyLists
        ? earlyLists.keyword
        : this.fetchKeywordList(args);
      const vector = earlyLists
        ? earlyLists.vector
        : queryVector
          ? this.fetchVectorList({ ...args, queryVector })
          : undefined;
      const taxonomy = earlyLists
        ? earlyLists.taxonomy
        : queryVector
          ? this.fetchTaxonomyList({ ...args, queryVector })
          : undefined;
      const need =
        needs.length > 0
          ? this.runRankedList(args, 'hybrid_rrf_need', {
              bool: {
                filter: filters,
                should: this.needRankFeatureClauses(needs, 1),
                minimum_should_match: 1,
              },
            })
          : undefined;

      const [keywordRes, vectorRes, taxonomyRes, needRes] =
        await Promise.allSettled([keyword, vector, taxonomy, need]);
      const failed = (name: string, res: PromiseRejectedResult) =>
        this.logger.warn(
          `RRF ${name} list failed: ${(res.reason as Error)?.message}`,
        );
      if (keywordRes.status === 'rejected') failed('keyword', keywordRes);
      if (vectorRes.status === 'rejected') failed('vector', vectorRes);
      if (taxonomyRes.status === 'rejected') failed('taxonomy', taxonomyRes);
      if (needRes.status === 'rejected') failed('need', needRes);
      // `undefined` from the vector promise: no embedding, so no vector list.
      const vectorList =
        vectorRes.status === 'fulfilled' ? vectorRes.value : undefined;
      if (vectorRes.status === 'fulfilled' && vectorList === undefined) {
        this.logger.warn('RRF vector list skipped: no query vector');
      }
      const valueOf = (res: PromiseSettledResult<RankedList | undefined>) =>
        res.status === 'fulfilled' ? res.value : undefined;
      const keywordList = valueOf(keywordRes);
      const taxonomyList = valueOf(taxonomyRes);
      const needList = valueOf(needRes);

      // Judges only when the keyword and the vector list both succeeded. No
      // lexical clause sends no keyword list: that is a success with top 0.
      const judges: Judges | undefined =
        keywordRes.status === 'fulfilled' && vectorList !== undefined
          ? {
              keyword_top: keywordList?.top ?? 0,
              vector_top: vectorList.top,
            }
          : undefined;

      // Order: keyword, vector, taxonomy, need. The weights follow the lists.
      const lists: string[][] = [];
      const weights: number[] = [];
      for (const [ids, weight] of [
        [keywordList?.ids, 1],
        [vectorList?.ids, 1],
        [taxonomyList?.ids, 1],
        [needList?.ids, RRF_NEED_LIST_WEIGHT],
      ] as const) {
        if (ids === undefined) continue;
        lists.push(ids);
        weights.push(weight);
      }
      if (lists.length === 0) {
        this.logger.warn('RRF every list failed, using summed ranking');
        return {};
      }
      const kept = reciprocalRankFusion(lists, RRF_K, weights).slice(
        0,
        RRF_LIST_SIZE,
      );
      if (kept.length === 0) return { judges };

      let ordered = kept;
      if (args.nearYou && args.coords?.length === 2) {
        const proximity = await this.runProximityList(
          args,
          filters,
          kept,
          args.coords,
        ).catch((error: Error) => {
          this.logger.warn(
            `RRF proximity list failed, using relevance fusion: ${error.message}`,
          );
          return [] as string[];
        });
        if (proximity.length > 0) {
          const inKept = new Set(kept);
          ordered = reciprocalRankFusion([...lists, proximity], RRF_K, [
            ...weights,
            RRF_PROXIMITY_RELEVANCE_WEIGHT,
          ]).filter((id) => inKept.has(id));
        }
      }
      return { ids: ordered, judges };
    } catch (error) {
      this.logger.warn(
        `RRF lists failed, using summed ranking: ${(error as Error).message}`,
      );
      return {};
    }
  }

  /**
   * The proximity list: the ids of `pool` (the kept set) ordered by distance
   * to `coords`, nearest first. The pool is relevance-gated on purpose: a
   * close but irrelevant service must not win. A service with no
   * `location.point` gets no vote. Distance ties break by position in `pool`
   * (relevance order), sorted here because Elasticsearch tie order is not
   * stable. Rejects when the request fails; `fetchFusedOrder` handles that.
   */
  private async runProximityList(
    args: { index: string; preference: string },
    filters: QueryDslQueryContainer[],
    pool: string[],
    coords: number[],
  ): Promise<string[]> {
    const response = await this.metrics.observeDownstream(
      'elasticsearch',
      'hybrid_rrf_proximity',
      () =>
        this.elasticsearchService.search({
          index: args.index,
          preference: args.preference,
          size: pool.length,
          _source: false,
          track_total_hits: false,
          query: {
            bool: {
              filter: [...filters, { ids: { values: pool } }],
            },
          },
          sort: [SearchUtilsService.getGeoDistanceSort(coords)],
        }),
    );
    const position = new Map(pool.map((id, i) => [id, i]));
    return response.hits.hits
      .filter((h): h is typeof h & { _id: string } => h._id !== undefined)
      .flatMap((h) => {
        const value = h.sort?.[0];
        // Elasticsearch sorts a doc with no point last, with a huge value.
        return typeof value === 'number' &&
          Number.isFinite(value) &&
          value < NO_POINT_METERS
          ? [{ id: h._id, meters: value }]
          : [];
      })
      .sort(
        (x, y) =>
          x.meters - y.meters ||
          (position.get(x.id) ?? 0) - (position.get(y.id) ?? 0),
      )
      .map((h) => h.id);
  }

  /**
   * Per-word idf over the tenant's documents, so the name edge tier weights a
   * word by how rare it is instead of by how rare its prefix is among names.
   * Cached per word: one multi-get for all words, one Elasticsearch probe for
   * the words that missed, one multi-set for what the probe found.
   * Never rejects: any failure returns null and the flat name match stays.
   */
  private async getWordRarity(
    index: string,
    tenantId: string,
    lang: string,
    queryStr: string,
    preference: string,
  ): Promise<WordRarity> {
    if (queryStr.trim().length === 0) return null;
    const words = contentWords(queryStr, lang);
    if (words.length === 0) return { words: {}, splits: [], typoClauses: true };

    try {
      const keys = words.map((w) => wordRarityCacheKey(tenantId, lang, w));
      const cached =
        await this.requestCacheService.getMany<WordRarityEntry>(keys);
      const entries = new Map<string, WordRarityEntry>();
      const missing: string[] = [];
      words.forEach((w, i) => {
        const hit = cached[i];
        if (
          hit &&
          typeof hit.idf === 'number' &&
          typeof hit.docs === 'number'
        ) {
          entries.set(w, hit);
        } else missing.push(w);
      });

      if (missing.length > 0) {
        // A failed probe throws, so nothing is written to the cache.
        const probed = await this.probeWordRarity(
          index,
          tenantId,
          missing,
          preference,
        );
        const toCache: Record<string, WordRarityEntry> = {};
        for (const [w, probe] of probed) {
          entries.set(w, probe.entry);
          if (probe.complete) {
            toCache[wordRarityCacheKey(tenantId, lang, w)] = probe.entry;
          }
        }
        await this.requestCacheService.setMany(toCache, WORD_RARITY_TTL_MS);
        await this.requestCacheService.deleteMany(
          this.wordRarityKeys.add(Object.keys(toCache)),
        );
      }

      const rarity: NonNullable<WordRarity> = {
        words: {},
        splits: [],
        typoClauses: true,
      };
      const docs: number[] = [];
      for (const w of words) {
        const entry = entries.get(w)!;
        docs.push(entry.docs);
        rarity.words[w] = entry.idf;
        if (entry.split) rarity.splits.push({ word: w, ...entry.split });
      }
      rarity.typoClauses = needsTypoClauses(docs, words.length);
      return rarity;
    } catch (error) {
      this.logger.warn(
        `Word rarity lookup failed, keeping flat name match: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /** Starts the query embedding. Never rejects: a failure logs the same warning as before and resolves undefined (lexical-only fallback). */
  startEmbedding(query: string): Promise<number[] | undefined> {
    return this.embedQuery(query).catch((err: Error) => {
      this.logger.warn(
        `Embedding failed, falling back to lexical-only: ${err.message}`,
      );
      return undefined;
    });
  }

  /**
   * One size-0 Elasticsearch request that counts documents for every word and
   * for every split candidate of those words. `complete` is false for a word
   * whose split candidates were cut by MAX_SPLIT_BUCKETS: that entry is right
   * for this request only, so it is not cached.
   */
  private async probeWordRarity(
    index: string,
    tenantId: string,
    words: string[],
    preference: string,
  ): Promise<Map<string, { entry: WordRarityEntry; complete: boolean }>> {
    const buckets: Record<string, QueryDslQueryContainer> = {};
    words.forEach((w, i) => {
      buckets[`w${i}`] = {
        multi_match: {
          query: w,
          type: 'phrase_prefix',
          fields: WORD_RARITY_FIELDS,
        },
      };
    });
    // Document count per word over the general recall fields: the same fields
    // the recall clause searches, so a word with few documents here is a word
    // the recall clause barely matches (the typo gate, ISS-2793).
    words.forEach((w, i) => {
      buckets[`c${i}`] = {
        multi_match: {
          query: w,
          fields: SearchUtilsService.GENERAL_RECALL_FIELDS,
        },
      };
    });
    // Split candidates ("foo dbank", "food bank", ...) are counted as exact
    // phrases, so the index's own counts pick the real split.
    let splitBuckets = 0;
    const candidates: string[][] = [];
    const complete: boolean[] = [];
    words.forEach((w, i) => {
      const all = splitCandidates(w);
      const phrases = all.slice(
        0,
        Math.max(0, MAX_SPLIT_BUCKETS - splitBuckets),
      );
      phrases.forEach((phrase, k) => {
        buckets[`s${i}_${k}`] = {
          multi_match: {
            query: phrase,
            type: 'phrase',
            fields: WORD_RARITY_FIELDS,
          },
        };
      });
      splitBuckets += phrases.length;
      candidates.push(phrases);
      complete.push(phrases.length === all.length);
    });

    const response = await this.metrics.observeDownstream(
      'elasticsearch',
      'hybrid_word_rarity',
      () =>
        this.elasticsearchService.search({
          index,
          preference,
          size: 0,
          track_total_hits: true,
          query: { term: { tenant_id: tenantId } },
          aggs: {
            df: { filters: { filters: buckets } },
          },
        }),
    );

    const total = response.hits?.total;
    const n = typeof total === 'number' ? total : total?.value;
    const counts = (response.aggregations as any)?.df?.buckets;
    if (typeof n !== 'number' || !(n > 0) || !counts) {
      throw new Error('malformed word rarity response');
    }

    const out = new Map<
      string,
      { entry: WordRarityEntry; complete: boolean }
    >();
    words.forEach((w, i) => {
      const df = counts[`w${i}`]?.doc_count;
      if (typeof df !== 'number') {
        throw new Error('malformed word rarity response');
      }

      const docs = counts[`c${i}`]?.doc_count;
      if (typeof docs !== 'number') {
        throw new Error('malformed word rarity response');
      }

      // Keep the most common split, and only when it is more common than the
      // run-together word itself.
      let best: { phrase: string; df: number } | null = null;
      candidates[i].forEach((phrase, k) => {
        const phraseDf = counts[`s${i}_${k}`]?.doc_count;
        if (typeof phraseDf === 'number' && (!best || phraseDf > best.df)) {
          best = { phrase, df: phraseDf };
        }
      });
      const top = best as { phrase: string; df: number } | null;
      out.set(w, {
        entry: {
          idf: idf(n, df),
          docs,
          split:
            top && top.df > df && top.df > 0
              ? { phrase: top.phrase, idf: idf(n, top.df) }
              : null,
        },
        complete: complete[i],
      });
    });
    return out;
  }

  /**
   * Embeds the query text. The vector is cached by model and hashed text
   * (24 h by default), so a repeated query skips the embedding API. A cache
   * failure never fails the search: RequestCacheService treats a Redis error
   * as a miss, and a thrown factory writes nothing. With
   * EMBEDDING_LOCAL_BASE_URL set, a miss asks the own TEI server and
   * EMBEDDING_BASE_URL at once and takes the first good answer.
   */
  async embedQuery(query: string): Promise<number[]> {
    return withSpan('hybrid.embed', async (span) => {
      const text = normalizeQueryText(query);
      if (!this.embeddingCacheEnabled || !this.embeddingModel) {
        span.setAttribute('hybrid.embed_cache_hit', false);
        return this.fetchEmbedding(text, span);
      }
      const key = queryEmbeddingCacheKey(this.embeddingModel, text);
      let called = false;
      const packed = await this.requestCacheService.getOrSet<string>(
        key,
        async () => {
          called = true;
          return packEmbedding(await this.fetchEmbedding(text, span));
        },
        this.embeddingCacheTtlMs,
      );
      const cached = unpackEmbedding(packed);
      if (cached) {
        span.setAttribute('hybrid.embed_cache_hit', !called);
        return cached;
      }
      // A stored value that does not decode counts as a miss: ask the API
      // and overwrite it.
      span.setAttribute('hybrid.embed_cache_hit', false);
      const fresh = await this.fetchEmbedding(text, span);
      await this.requestCacheService.setMany(
        { [key]: packEmbedding(fresh) },
        this.embeddingCacheTtlMs,
      );
      return fresh;
    });
  }

  private async requestEmbedding(
    baseUrl: string,
    // null = send no Authorization header (own TEI server has no key).
    apiKey: string | undefined | null,
    operation: 'embed' | 'embed_local',
    query: string,
  ): Promise<number[]> {
    const response = await this.metrics.observeDownstream(
      'embedding',
      operation,
      () =>
        fetch(`${baseUrl}/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey === null ? {} : { Authorization: `Bearer ${apiKey}` }),
          },
          body: JSON.stringify({ model: this.embeddingModel, input: query }),
          signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
        }),
      (res) => (res.ok ? 'ok' : 'error'),
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Embedding API returned ${response.status}: ${text}`);
    }

    const data: EmbeddingResponse = await response.json();
    return data.data[0].embedding;
  }

  /**
   * One embedding call to EMBEDDING_BASE_URL. With EMBEDDING_LOCAL_BASE_URL
   * set, it races the own TEI server against it (same model, same cache key)
   * and records the winner on the span.
   */
  private async fetchEmbedding(query: string, span: Span): Promise<number[]> {
    this.logger.debug(
      `Embedding query: ${describeQueryForLog(query)} using model: ${this.embeddingModel}`,
    );

    if (!this.embeddingBaseUrl || !this.embeddingModel) {
      throw new InternalServerErrorException(
        'EMBEDDING_BASE_URL and EMBEDDING_MODEL must be configured for hybrid search',
      );
    }

    const localBaseUrl = this.embeddingLocalBaseUrl;
    try {
      let embedding: number[];
      if (localBaseUrl) {
        const side =
          (name: EmbeddingSide, call: () => Promise<number[]>) => async () => {
            try {
              return await call();
            } catch (err) {
              this.logger.warn(
                `Embedding ${name} side failed: ${(err as Error).message}`,
              );
              throw err;
            }
          };
        const result = await raceEmbeddings({
          local: side('local', () =>
            this.requestEmbedding(localBaseUrl, null, 'embed_local', query),
          ),
          remote: side('remote', () =>
            this.requestEmbedding(
              this.embeddingBaseUrl,
              this.runpodApiKey,
              'embed',
              query,
            ),
          ),
        });
        span.setAttribute('hybrid.embed_winner', result.winner);
        embedding = result.embedding;
      } else {
        embedding = await this.requestEmbedding(
          this.embeddingBaseUrl,
          this.runpodApiKey,
          'embed',
          query,
        );
      }

      this.logger.debug(`Embedding length: ${embedding.length}`);
      return embedding;
    } catch (error) {
      if (localBaseUrl) span.setAttribute('hybrid.embed_winner', 'none');
      this.logger.error(`Failed to embed query: ${error.message}`, error.stack);
      throw new InternalServerErrorException(
        `Query embedding failed: ${error.message}`,
      );
    }
  }

  private async getTaxonomyCodes(
    queryVector: number[],
    tenantId: string,
    preference: string,
    exact: boolean,
  ): Promise<PredictedTaxonomy[]> {
    try {
      const result = await this.metrics.observeDownstream(
        'elasticsearch',
        // Label stays 'taxonomy_knn' for dashboard continuity.
        'taxonomy_knn',
        () =>
          this.elasticsearchService.search<{
            code: string;
            name: string;
          }>({
            index: 'hybrid_taxonomies',
            preference,
            size: TAXONOMY_K,
            track_total_hits: false,
            _source: ['code', 'name'],
            ...(exact
              ? {
                  // Exact cosine over the tenant's codes. (1 + cos) / 2 is the
                  // same scale as the knn _score for cosine similarity, so
                  // BASE_TAXONOMY_BOOST x score keeps its meaning. Approximate
                  // knn matched the exact top 10 on 73% of 300 real queries
                  // (ISS-2692).
                  query: {
                    script_score: {
                      query: { term: { tenant_id: tenantId } },
                      script: {
                        source:
                          "(cosineSimilarity(params.qv, 'embedding') + 1.0) / 2.0",
                        params: { qv: queryVector },
                      },
                    },
                  },
                }
              : {
                  knn: {
                    field: 'embedding',
                    query_vector: queryVector,
                    k: TAXONOMY_K,
                    num_candidates: TAXONOMY_NUM_CANDIDATES,
                    filter: [{ term: { tenant_id: tenantId } }],
                  },
                }),
          }),
      );

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
   * Nested filter constraining results to a set of taxonomy codes. Shared by
   * the hybrid search hard scope and getDocumentsCount.
   *
   * Default (v1 hybrid): exact `terms` on the keyword field.
   * `includeChildren` (v2 only, ISS-2612): each code matches itself and its
   * child codes on the code boundary. HSIS children start with "." (BD-1800.2000)
   * or "-" (BD-1800.8200-250), so the clauses are the exact term plus
   * `<code>.` and `<code>-` prefixes. BD-1800 never matches BD-18000. Several
   * codes stay an OR (one `bool.should`, minimum_should_match 1).
   */
  private buildHardTaxonomyScopeFilter(
    codes: string[],
    options: { includeChildren?: boolean } = {},
  ): QueryDslQueryContainer {
    if (!options.includeChildren) {
      return {
        nested: {
          path: 'taxonomies',
          query: { terms: { 'taxonomies.code': codes } },
        },
      };
    }
    return {
      nested: {
        path: 'taxonomies',
        query: {
          bool: {
            should: codes.flatMap((code) => [
              { term: { 'taxonomies.code': code } },
              { prefix: { 'taxonomies.code': `${code}.` } },
              { prefix: { 'taxonomies.code': `${code}-` } },
            ]),
            minimum_should_match: 1,
          },
        },
      },
    };
  }

  /**
   * One nested constant_score clause per predicted code. constant_score keeps
   * each contribution equal to the boost (no term-IDF noise); the bool sums
   * matching clauses, so a doc carrying several predicted codes accumulates
   * them and the highest-scoring predicted code contributes the most.
   * boost = BASE_TAXONOMY_BOOST * lengthScale * score * (1 + 0.5 / (1 + i))
   *
   * lengthScale grows with the query's token count: the recall clause's BM25
   * sums weak token matches across many fields, so long natural-language
   * queries inflate lexical scores to the hundreds and a flat boost becomes
   * invisible there, while 1–3-token queries keep the balance the boosts were
   * tuned on. 1–3 tokens → ×1; one unit per TAXONOMY_BOOST_TOKENS_PER_UNIT
   * tokens beyond that, capped at TAXONOMY_BOOST_MAX_SCALE.
   */
  private buildTaxonomyBoostClauses(
    predicted: PredictedTaxonomy[],
    queryStr?: string,
  ): QueryDslQueryContainer[] {
    const tokens = queryStr?.trim().split(/\s+/).filter(Boolean).length ?? 1;
    const lengthScale = Math.min(
      TAXONOMY_BOOST_MAX_SCALE,
      Math.max(1, Math.floor(tokens / TAXONOMY_BOOST_TOKENS_PER_UNIT)),
    );
    return predicted.map((sc, i) => ({
      nested: {
        path: 'taxonomies',
        query: {
          constant_score: {
            filter: { term: { 'taxonomies.code': sc.code } },
            boost:
              BASE_TAXONOMY_BOOST *
              lengthScale *
              sc.score *
              (1 + 0.5 / (1 + i)),
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
   *   Each content word adds boost x idf when a name word starts with it;
   *   function words add nothing; a null `wordRarity` keeps the flat OR match.
   * `includePhrase` – enables mid-string phrase matching on `.clean`
   *   (match_phrase + match_phrase_prefix). Suppress for single-token org
   *   queries to avoid noisy mid-field token hits ("health" → every
   *   "X Health Center").
   */
  private buildNameTierClauses(
    field: string,
    boost: number,
    queryStr: string,
    opts: {
      includePhrase: boolean;
      includeEdge?: boolean;
      wordRarity?: WordRarity;
    },
  ): QueryDslQueryContainer[] {
    const queryLower = queryStr.toLowerCase();
    const clauses: QueryDslQueryContainer[] = [
      { term: { [`${field}.lc`]: { value: queryLower, boost } } },
      { prefix: { [`${field}.lc`]: { value: queryLower, boost } } },
    ];
    if (opts.includeEdge) {
      if (opts.wordRarity == null) {
        clauses.push({
          match: { [`${field}.edge`]: { query: queryStr, boost } },
        });
      } else {
        for (const [word, weight] of Object.entries(opts.wordRarity.words)) {
          clauses.push({
            constant_score: {
              filter: { match: { [`${field}.edge`]: word } },
              boost: boost * weight,
            },
          });
        }
        // JOIN: run-together names ("food bank near me" -> "Foodbank of
        // Central New York", "my free taxes" -> "MyFreeTaxes.com"). A join
        // covers its words, so it is worth their rarity together. This is the
        // shingle method (Elasticsearch `shingle` with `token_separator: ""`),
        // done in code so no index change is needed. Function words are not in
        // `words`, so they add 0. `.clean` is lowercase + asciifolding with the
        // standard tokenizer, so "MyFreeTaxes.com" is the token "myfreetaxes.com".
        for (const { join, words } of adjacentJoins(queryStr)) {
          const sum = words.reduce(
            (a, w) => a + (opts.wordRarity!.words[w] ?? 0),
            0,
          );
          if (sum <= 0) continue;
          clauses.push({
            constant_score: {
              filter: { prefix: { [`${field}.clean`]: join } },
              boost: boost * sum,
            },
          });
        }
        // SPLIT: the WordBreakSpellChecker method (Lucene), using the index's
        // own counts: "foodbank" -> "food bank".
        for (const split of opts.wordRarity.splits) {
          clauses.push({
            constant_score: {
              filter: { match_phrase: { [`${field}.clean`]: split.phrase } },
              boost: boost * split.idf,
            },
          });
        }
      }
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
    wordRarity: WordRarity = null,
  ): QueryDslQueryContainer[] {
    // Phrase clauses on org name are noisy for single-token queries: "health"
    // would match every "X Health Center" even when its services are unrelated.
    // Exact + prefix on .lc are anchored to the start of the org name field and
    // are safe — single-token "rainbow" still finds "Rainbow House". Phrase
    // matching is enabled only for multi-token queries ("salvation army",
    // "american red cross of greater chicago").
    const isMultiToken =
      queryStr.trim().split(/\s+/).filter(Boolean).length >= 2;

    // organization.name is handled exclusively via the name tier below; see
    // GENERAL_RECALL_FIELDS for why it and organization.description are out.
    const generalFields = SearchUtilsService.GENERAL_RECALL_FIELDS;
    // A null word rarity (v1, failed lookup, no caller input) keeps them.
    const typoClauses = wordRarity?.typoClauses !== false;

    const recallClause: QueryDslQueryContainer = {
      multi_match: {
        operator: 'or',
        minimum_should_match: '2<75%',
        fields: generalFields,
        query: queryStr,
      },
    };
    const nestedRecallClause: QueryDslQueryContainer = {
      multi_match: {
        analyzer: 'standard',
        operator: 'or',
        minimum_should_match: '2<75%',
        fields: SearchUtilsService.NESTED_FIELDS_TO_QUERY,
        query: queryStr,
      },
    };

    return [
      // Top-level name: highest signal — edge-ngram + phrase on .clean
      ...this.buildNameTierClauses('name', BM25_NAME_BOOST, queryStr, {
        includePhrase: true,
        includeEdge: true,
        wordRarity,
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
      recallClause,
      // SPLIT recall: lets "foodbank" score documents that say "food bank".
      // Membership is unchanged: the main query has minimum_should_match 0.
      // Plain BM25, no boost.
      ...(wordRarity?.splits ?? []).map((split): QueryDslQueryContainer => ({
        multi_match: {
          query: split.phrase,
          type: 'phrase',
          fields: generalFields,
        },
      })),
      // Typo tolerance belongs on the recall clause: the name tiers above are
      // phrase/prefix by design, and the use_references clause below is
      // curated, where an approximate match defeats the curation. Both typo
      // clauses are left out when the rarity gate says every content word of
      // the query is a real word (more than TYPO_GATE_MAX_DOCS documents).
      ...(typoClauses ? [fuzzyFallbackFor(recallClause)] : []),
      // Nested taxonomy name/description boost
      { nested: { path: 'taxonomies', query: nestedRecallClause } },
      ...(typoClauses
        ? [
            {
              nested: {
                path: 'taxonomies',
                query: fuzzyFallbackFor(nestedRecallClause),
              },
            },
          ]
        : []),
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
    v2 = false,
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
      const scaleMi = distance > 0 ? distance : GEO_DEFAULT_SCALE_MI;
      const scale = `${scaleMi}mi`;
      functions.push({
        // A decay function scores a document that lacks the field as 1, the
        // same as one at the origin. Without this filter a listing with no map
        // point got the full distance bonus (ISS-2755). With it, the listing
        // gets 0 from distance, except that a document matching no function
        // at all scores 1: with no embedding (browse, or the text-only
        // fallback) and no priority function (pinned mode top/ignore), a
        // listing with no point gets +1. See docs/location-search.md.
        filter: { exists: { field: 'location.point' } },
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
      if (v2) {
        // v2: a service with no map point gets the distance score of a
        // service VIRTUAL_DISTANCE_IN_SCALES scales away, the same gauss
        // value, as a flat weight. v1 keeps 0 for these services.
        functions.push({
          filter: {
            bool: { must_not: [{ exists: { field: 'location.point' } }] },
          },
          weight: virtualDistanceWeight(),
        });
      }
    }

    return functions;
  }

  /**
   * `sort` picks the order, the query still decides membership (ISS-1367).
   * pinned/priority lead only when `pinned_resources_mode` is `top`; v2 with
   * a query passes `ignore` here and the pinned gate decides the lead.
   */
  private buildHybridSort(
    sortOption: SearchResourcesQueryDto['sort'],
    coords: number[] | undefined,
    pinnedMode: PinnedResourcesMode,
    selectedNeeds: string[] = [],
  ): Sort {
    return SearchUtilsService.buildSortClause({
      fields: HYBRID_SORT_FIELDS,
      sortOption,
      coords,
      leadingTiers: [
        ...(needBlockLeads(selectedNeeds, sortOption, coords)
          ? [buildNeedBlockSort(selectedNeeds)]
          : []),
        ...(pinnedMode === 'top'
          ? [
              { pinned: 'desc' } as SortCombinations,
              { priority: 'desc' } as SortCombinations,
            ]
          : []),
      ],
    });
  }

  /**
   * Locates the cutoff on **semantic and lexical relevance only**.
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
   * One Elasticsearch search inside a named span (trace only, no metric
   * series), with the server-side `took` on the span.
   */
  private tracedSearch<TDocument>(operation: string, request: SearchRequest) {
    return withSpan(`elasticsearch ${operation}`, async (span) => {
      const response =
        await this.elasticsearchService.search<TDocument>(request);
      span.setAttribute('downstream.took_ms', response.took);
      return response;
    });
  }

  private async probeRelevanceCutoff(args: {
    index: string;
    preference: string;
    queryStr: string;
    queryVector: number[] | undefined;
    predicted: PredictedTaxonomy[];
    filters: QueryDslQueryContainer[];
    pinnedMode: PinnedResourcesMode;
    wordRarity: WordRarity;
    keyword: boolean;
    /** Active needs; set only for v2 with the need boost active (option A). */
    needs?: NeedScore[];
  }): Promise<{ keptIds: string[] | null; cutoff: RelevanceCutoffDto }> {
    const {
      index,
      preference,
      queryStr,
      queryVector,
      predicted,
      filters,
      pinnedMode,
      wordRarity,
      keyword,
      needs,
    } = args;

    const should = [
      ...(queryStr && keyword
        ? this.buildLexicalShouldClauses(queryStr, wordRarity)
        : []),
      ...this.buildTaxonomyBoostClauses(predicted, queryStr),
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

    const buildProbeQuery = (
      extraShould: QueryDslQueryContainer[],
      extraFilter?: QueryDslQueryContainer,
    ): QueryDslQueryContainer => {
      const innerBool: QueryDslQueryContainer = {
        bool: {
          minimum_should_match: 0,
          filter: extraFilter ? [...filters, extraFilter] : filters,
          should: [...should, ...extraShould],
        },
      };
      return scoreFunctions.length > 0
        ? {
            function_score: {
              query: innerBool,
              functions: scoreFunctions,
              score_mode: 'sum',
              boost_mode: 'sum',
            },
          }
        : innerBool;
    };

    /**
     * The rule needs three numbers — the top score, the top-20 score, and how
     * many results sit above a fraction of the top — and Elasticsearch answers
     * all of them without collecting documents. The head call returns the top
     * `CUTOFF_TOP_DOCS_FLOOR + 1` scores in one pass: rank 0 for `topScore`,
     * rank 20 for the clamp. `size: 0` with `min_score` returns a count in
     * about a millisecond over a 27,000-result population, where fetching a
     * 300-document window costs ~250ms and still cannot see a cut that lands
     * at 388.
     *
     * The threshold is `min(fraction × topScore, top-20 score)` — the clamp
     * guarantees the probe's own top-20 survive the cut, which is the metric
     * the fraction rule alone was measured to violate (Washington/Iowa Q3,
     * Santa Cruz Q4). When the clamped fraction leaves more survivors than
     * MAX_ENUMERATED_CUT, the fraction climbs the ladder and the first rung
     * that enumerates is applied; past the ladder the probe declines with
     * `cut_too_large` as before.
     *
     * Documents are fetched only once the cut is known to be worth making, so
     * the expensive call is proportional to the cut rather than to a fixed
     * window.
     *
     * `min_score` is inclusive, so a group of results tied exactly at the
     * threshold is kept or dropped whole — the boundary cannot split a tie.
     */
    // A private projection, not the response shape: the probe asks only for the
    // grouping key, so it must not borrow the public `SearchSource` DTO.
    type ProbeSource = { service_id?: string };
    const fraction = CUTOFF_FRACTION_OF_MAX;
    const minKeep = CUTOFF_MIN_KEEP_SERVICES;

    const headRequest = (query: QueryDslQueryContainer) => ({
      index,
      preference,
      size: CUTOFF_TOP_DOCS_FLOOR + 1,
      track_total_hits: true,
      _source: false as const,
      sort: ['_score'],
      query,
    });
    const totalOf = (res: {
      hits: { total?: number | { value: number } };
    }): number =>
      typeof res.hits.total === 'number'
        ? res.hits.total
        : (res.hits.total?.value ?? 0);

    let query: QueryDslQueryContainer;
    let matched: number;
    let topScore: number;
    // Clamp anchor: the score the probe's own top-20 ends at. Absent when the
    // matched set is smaller than the floor window — nothing to protect there.
    let s20: number | undefined;

    if (needs && needs.length > 0) {
      // Option A: with the need boost active the cut is made after the boost,
      // sized as a fraction of this probe's own unboosted top score (no
      // distance, so it does not depend on where the person is). The unboosted
      // head and the need-tagged head start together; the boosted top 21 is
      // computed here from both, so no separate own-top-score call waits in
      // front of the head.
      const taggedFilter: QueryDslQueryContainer = {
        bool: {
          should: needs.map((n) => ({
            exists: { field: boostFeatureField(n) },
          })),
          minimum_should_match: 1,
        },
      };
      type TaggedSource = {
        sune_need_weights?: Record<string, unknown>;
        sune_urgency_weights?: Record<string, unknown>;
      };
      const [baseHead, taggedHead] = await Promise.all([
        this.metrics.observeDownstream(
          'elasticsearch',
          'hybrid_cutoff_head',
          () =>
            this.tracedSearch<SearchSource>(
              'hybrid_cutoff_head',
              headRequest(buildProbeQuery([])),
            ),
        ),
        this.metrics
          .observeDownstream('elasticsearch', 'hybrid_cutoff_tagged_head', () =>
            this.tracedSearch<TaggedSource>('hybrid_cutoff_tagged_head', {
              index,
              preference,
              size: CUTOFF_TAGGED_HEAD_SIZE,
              track_total_hits: false,
              _source: needs.map(boostFeatureField),
              sort: ['_score'],
              query: buildProbeQuery([], taggedFilter),
            }),
          )
          // A failed tagged head leaves the probe unboosted, as a failed
          // own-top-score call did.
          .catch((error: Error) => {
            this.logger.warn(`Need boost skipped: ${error.message}`);
            return undefined;
          }),
      ]);

      // Membership does not change with should clauses (minimum_should_match
      // is 0), so the base total is the matched count of the boosted query.
      matched = totalOf(baseHead);
      const ownTop = baseHead.hits.hits[0]?._score ?? 0;

      if (ownTop > 0 && taggedHead) {
        const needShould = this.buildNeedBoostClauses(needs, ownTop);
        query = buildProbeQuery(needShould);
        const k = NEED_BOOST_FRACTION * ownTop;
        const base = new Map<string, number>();
        const boostOf = new Map<string, number>();
        for (const h of baseHead.hits.hits) {
          if (h._id !== undefined) base.set(h._id, h._score ?? 0);
        }
        for (const h of taggedHead.hits.hits) {
          if (h._id === undefined) continue;
          base.set(h._id, h._score ?? 0);
          let boost = 0;
          for (const n of needs) {
            boost +=
              this.needBoostValue(k, n) * this.boostWeightOf(h._source, n);
          }
          boostOf.set(h._id, boost);
        }
        const scores = [...base.entries()]
          .map(
            ([id, score]) =>
              score +
              (boostOf.get(id) ?? 0) * (1 - RANK_FEATURE_PRECISION_LOSS),
          )
          .sort((a, b) => b - a);
        topScore = scores[0] ?? 0;
        s20 =
          scores.length > CUTOFF_TOP_DOCS_FLOOR
            ? scores[CUTOFF_TOP_DOCS_FLOOR]
            : undefined;
      } else {
        // ownTop <= 0 (or no tagged head): no boost, the base head stands.
        query = buildProbeQuery([]);
        topScore = baseHead.hits.hits[0]?._score ?? 0;
        s20 =
          baseHead.hits.hits.length > CUTOFF_TOP_DOCS_FLOOR
            ? baseHead.hits.hits[CUTOFF_TOP_DOCS_FLOOR]?._score
            : undefined;
      }
    } else {
      query = buildProbeQuery([]);
      const head = await this.tracedSearch<SearchSource>(
        'hybrid_cutoff_head',
        headRequest(query),
      );
      matched = totalOf(head);
      topScore = head.hits.hits[0]?._score ?? 0;
      s20 =
        head.hits.hits.length > CUTOFF_TOP_DOCS_FLOOR
          ? head.hits.hits[CUTOFF_TOP_DOCS_FLOOR]?._score
          : undefined;
    }

    const decline = (
      reason: RelevanceCutoffDto['reason'],
      examined: number,
    ): { keptIds: null; cutoff: RelevanceCutoffDto } => ({
      keptIds: null,
      cutoff: {
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

    const thresholdFor = (f: number): number =>
      Math.min(f * topScore, s20 ?? Infinity);

    const countSurvivors = async (threshold: number): Promise<number> => {
      const counted = await this.tracedSearch<SearchSource>(
        'hybrid_cutoff_count',
        {
          index,
          preference,
          size: 0,
          track_total_hits: true,
          min_score: threshold,
          query,
        },
      );
      return typeof counted.hits.total === 'number'
        ? counted.hits.total
        : (counted.hits.total?.value ?? 0);
    };

    let threshold = thresholdFor(fraction);
    // One call returns the survivor count and, when there are at most
    // MAX_ENUMERATED_CUT, the survivors themselves (`size` is one past the
    // limit, so a full page proves there are too many). That drops the
    // separate count that used to wait in front of the kept fetch, the common
    // case. Same query, threshold and sort as the kept fetch, so the kept ids
    // are the ones the two-call form returned.
    const firstCut = await this.tracedSearch<ProbeSource>(
      'hybrid_cutoff_first_cut',
      {
        index,
        preference,
        size: MAX_ENUMERATED_CUT + 1,
        track_total_hits: true,
        min_score: threshold,
        _source: ['service_id'],
        sort: ['_score'],
        query,
      },
    );
    let survivors = totalOf(firstCut);
    let preKept: typeof firstCut.hits.hits | undefined =
      survivors <= MAX_ENUMERATED_CUT ? firstCut.hits.hits : undefined;

    // Nothing meaningful scored below the threshold: the distribution is flat
    // and the honest answer is to return everything. This is the case a strict
    // fraction cannot express, and a lax one can.
    if (survivors >= matched * MIN_CUT_REDUCTION)
      return decline('no_elbow', matched);
    // The two failure branches are provably disjoint: if survivors@0.2 exceed
    // MAX_ENUMERATED_CUT then rank 20 sits inside the survivors, so s20 >=
    // threshold and the clamp cannot bind on the ladder path; if the clamp
    // binds at the base fraction, survivors <= 20 + ties and the ladder never
    // runs.
    if (survivors > MAX_ENUMERATED_CUT) {
      // Every rung count goes out at once; the first rung in ladder order
      // that enumerates wins, the same one the sequential loop picked.
      const rungs = await Promise.all(
        CUTOFF_FRACTION_LADDER.map(async (f) => {
          const rungThreshold = thresholdFor(f);
          return {
            threshold: rungThreshold,
            survivors: await countSurvivors(rungThreshold),
          };
        }),
      );
      const ladder =
        rungs.find((r) => r.survivors <= MAX_ENUMERATED_CUT) ?? null;
      if (!ladder) return decline('cut_too_large', survivors);
      threshold = ladder.threshold;
      survivors = ladder.survivors;
      preKept = undefined;
    }

    const keptHits =
      preKept ??
      (
        await this.tracedSearch<ProbeSource>('hybrid_cutoff_kept', {
          index,
          preference,
          size: Math.max(survivors, 1),
          track_total_hits: false,
          min_score: threshold,
          _source: ['service_id'],
          sort: ['_score'],
          query,
        })
      ).hits.hits;

    let hits = keptHits;
    let cutoffScore = hits[hits.length - 1]?._score ?? null;
    const services = new Set(
      hits.map((h) => String(h._source?.service_id ?? h._id)),
    );

    // The floor is denominated in services, not documents: one provider's
    // branches must not fill every slot while other providers are cut.
    if (services.size < minKeep) {
      const widened = await this.tracedSearch<ProbeSource>(
        'hybrid_cutoff_widened',
        {
          index,
          preference,
          size: SERVICE_FLOOR_WINDOW,
          track_total_hits: false,
          _source: ['service_id'],
          sort: ['_score'],
          query,
        },
      );
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
        applied: true,
        reason: null,
        kept: keptIds.length,
        matched_before_cutoff: matched,
        cutoff_score: cutoffScore,
        candidates_examined: survivors,
      },
    };
  }

  /**
   * Top base score for the need boost: the same query as the main request,
   * without the need clauses, asking for one hit.
   */
  private async fetchNeedBoostTopScore(args: {
    index: string;
    preference: string;
    queryStr: string;
    queryVector: number[] | undefined;
    predicted: PredictedTaxonomy[];
    filters: QueryDslQueryContainer[];
    coords: number[] | undefined;
    distance: number;
    pinnedMode: PinnedResourcesMode;
    wordRarity: WordRarity;
    keyword: boolean;
    v2: boolean;
  }): Promise<number> {
    const { index, preference, ...queryArgs } = args;
    return this.fetchTopScore('hybrid_need_boost_top_score', {
      index,
      preference,
      query: this.buildHybridScoredQuery(queryArgs),
    });
  }

  /**
   * v2 pinned gate (Lucas 2026-11-18). One request, size 0: relevance only
   * (lexical, taxonomy, vector; no geography, no pinned bonus), the same query
   * the cutoff probe uses minus its pinned clause. Returns pinned ids whose
   * relevance reaches PINNED_GATE_FRACTION x the best non-pinned relevance.
   * Never rejects: on error [] (no pinned bonus).
   */
  private async fetchPinnedGate(args: {
    index: string;
    preference: string;
    queryStr: string;
    queryVector: number[] | undefined;
    predicted: PredictedTaxonomy[];
    filters: QueryDslQueryContainer[];
    wordRarity: WordRarity;
    keyword: boolean;
  }): Promise<string[]> {
    const {
      index,
      preference,
      queryStr,
      queryVector,
      predicted,
      filters,
      wordRarity,
      keyword,
    } = args;
    try {
      const innerBool: QueryDslQueryContainer = {
        bool: {
          minimum_should_match: 0,
          filter: filters,
          should: [
            ...(queryStr && keyword
              ? this.buildLexicalShouldClauses(queryStr, wordRarity)
              : []),
            ...this.buildTaxonomyBoostClauses(predicted, queryStr),
          ],
        },
      };
      const scoreFunctions = this.buildScoreFunctions(
        queryVector,
        undefined,
        0,
      );
      const query: QueryDslQueryContainer =
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

      const response = await this.metrics.observeDownstream(
        'elasticsearch',
        'hybrid_pinned_gate',
        () =>
          this.elasticsearchService.search({
            index,
            preference,
            size: 0,
            track_total_hits: false,
            query,
            aggs: {
              pinned: {
                filter: { term: { pinned: true } },
                aggs: {
                  top: {
                    top_hits: { size: PINNED_GATE_MAX_HITS, _source: false },
                  },
                },
              },
              other: {
                filter: { bool: { must_not: [{ term: { pinned: true } }] } },
                aggs: { top: { top_hits: { size: 1, _source: false } } },
              },
            },
          }),
      );

      type GateAgg = {
        top?: { hits?: { hits?: { _id?: string; _score?: number | null }[] } };
      };
      const aggregations = response.aggregations as
        { pinned?: GateAgg; other?: GateAgg } | undefined;
      const pinnedHits = (aggregations?.pinned?.top?.hits?.hits ?? [])
        .filter((h) => typeof h._id === 'string')
        .map((h) => ({ id: h._id as string, score: h._score ?? 0 }));
      const topOther = aggregations?.other?.top?.hits?.hits?.[0]?._score ?? 0;
      const gated = selectGatedPinnedIds(pinnedHits, topOther);
      this.logger.debug(
        `Pinned gate: pinned hits=${pinnedHits.length}, top other=${topOther}, gated=${gated.length}`,
      );
      return gated;
    } catch (error) {
      this.logger.warn(`Pinned gate skipped: ${(error as Error).message}`);
      return [];
    }
  }

  /** Top score of a query (one hit, no source); 0 when absent or on error. */
  private async fetchTopScore(
    operation: string,
    args: { index: string; preference: string; query: QueryDslQueryContainer },
  ): Promise<number> {
    const { index, preference, query } = args;
    try {
      const response = await this.metrics.observeDownstream(
        'elasticsearch',
        operation,
        () =>
          this.elasticsearchService.search({
            index,
            preference,
            size: 1,
            _source: false,
            track_total_hits: false,
            sort: ['_score'],
            query,
          }),
      );
      const topScore = response.hits.hits[0]?._score ?? 0;
      if (topScore <= 0) {
        this.logger.warn('Need boost skipped: no top base score');
        return 0;
      }
      return topScore;
    } catch (error) {
      this.logger.warn(`Need boost skipped: ${(error as Error).message}`);
      return 0;
    }
  }

  /**
   * The rank_feature boost of one need. The one place that sizes it, used by
   * the boost clauses and by the probe's client-side top-21 computation, so
   * the two cannot drift.
   */
  private needBoostValue(k: number, need: NeedScore): number {
    return k * need.score * boostFactor(need);
  }

  /** The weight a service document carries for a boost term; 0 when it has none. */
  private boostWeightOf(
    source:
      | {
          sune_need_weights?: Record<string, unknown>;
          sune_urgency_weights?: Record<string, unknown>;
        }
      | undefined,
    n: NeedScore,
  ): number {
    return Number(source?.[boostGroupOf(n)]?.[n.code]) || 0;
  }

  /** One rank_feature clause per need, sized by `needBoostValue`. */
  private needRankFeatureClauses(
    needs: NeedScore[],
    k: number,
  ): QueryDslQueryContainer[] {
    return needs.map((need) => ({
      rank_feature: {
        field: boostFeatureField(need),
        linear: {},
        boost: this.needBoostValue(k, need),
      },
    }));
  }

  private buildNeedBoostClauses(
    needs: NeedScore[],
    topScore: number,
  ): QueryDslQueryContainer[] {
    return this.needRankFeatureClauses(needs, NEED_BOOST_FRACTION * topScore);
  }

  private buildHybridQuery(args: {
    index: string;
    preference: string;
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
    extraShould?: QueryDslQueryContainer[];
    wordRarity: WordRarity;
    keyword: boolean;
    fusedIds?: string[];
    /** With `fusedIds`: the page is in the fused order (sort relevance). */
    orderedByFusion?: boolean;
    gatedPinnedIds?: string[];
    selectedNeeds?: string[];
    v2: boolean;
  }): SearchRequest {
    const {
      index,
      preference,
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
      extraShould,
      wordRarity,
      keyword,
      fusedIds,
      orderedByFusion,
      gatedPinnedIds,
      selectedNeeds,
      v2,
    } = args;

    const sort = this.buildHybridSort(
      sortOption,
      coords,
      pinnedMode,
      selectedNeeds,
    );

    // The kept set (fusion): the page is the ids filter, ordered by the fused
    // ranking (pinned query; every kept doc is pinned, so no scoring clauses)
    // or by the sort clause. Totals, facets and paging then follow the kept
    // set, and a page past it has no hits.
    const keptFilter =
      fusedIds && fusedIds.length > 0
        ? { bool: { filter: [...filters, { ids: { values: fusedIds } }] } }
        : undefined;
    const esQuery =
      keptFilter ??
      this.buildHybridScoredQuery({
        queryStr,
        queryVector,
        predicted,
        filters,
        coords,
        distance,
        pinnedMode,
        extraShould,
        wordRarity,
        keyword,
        v2,
        gatedPinnedIds,
      });

    return {
      index,
      preference,
      from: (page - 1) * limit,
      size: limit,
      track_total_hits: true,
      _source: this.hybridSourceExcludes(),
      ...(selectedNeeds && selectedNeeds.length > 0
        ? {
            script_fields: {
              matched_needs: buildMatchedNeedsField(selectedNeeds),
            },
          }
        : {}),
      aggs,
      // The `pinned` query is free under the Basic license. It keeps the
      // fused order of the kept ids.
      query:
        keptFilter && orderedByFusion
          ? { pinned: { ids: fusedIds!, organic: keptFilter } }
          : esQuery,
      sort,
    };
  }

  private buildHybridScoredQuery(args: {
    queryStr: string;
    queryVector: number[] | undefined;
    predicted: PredictedTaxonomy[];
    filters: QueryDslQueryContainer[];
    coords: number[] | undefined;
    distance: number;
    pinnedMode: PinnedResourcesMode;
    extraShould?: QueryDslQueryContainer[];
    wordRarity: WordRarity;
    keyword: boolean;
    v2: boolean;
    /** v2 pinned gate: pinned ids that lead on the summed path. */
    gatedPinnedIds?: string[];
  }): QueryDslQueryContainer {
    const {
      queryStr,
      queryVector,
      predicted,
      filters,
      coords,
      distance,
      pinnedMode,
      extraShould,
      wordRarity,
      keyword,
      v2,
      gatedPinnedIds,
    } = args;

    // Browse mode (empty query): omit lexical should clauses; filters + vector +
    // geo + taxonomy boosts still produce a valid ranked, counted, paginated set.
    const lexicalShould =
      queryStr && keyword
        ? this.buildLexicalShouldClauses(queryStr, wordRarity)
        : [];
    const taxonomyShould = this.buildTaxonomyBoostClauses(predicted, queryStr);
    // When pinned_resources_mode is `boost`, pinned becomes a small additive
    // score contribution (constant_score) instead of a hard sort tier. When it
    // is `top`, the hard sort tiers handle ordering. When `ignore`, neither is
    // applied. v2 with a query passes `ignore` and uses the pinned gate
    // (gatedPinnedIds) instead.

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
    const should = [
      ...lexicalShould,
      ...taxonomyShould,
      ...pinnedShould,
      ...(extraShould ?? []),
      ...(gatedPinnedIds && gatedPinnedIds.length > 0
        ? [
            {
              constant_score: {
                filter: { ids: { values: gatedPinnedIds } },
                boost: PINNED_GATE_TIER_BOOST,
              },
            } as QueryDslQueryContainer,
          ]
        : []),
    ];

    const scoreFunctions = this.buildScoreFunctions(
      queryVector,
      coords,
      distance,
      v2,
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

    return esQuery;
  }

  /** The tenant's alias when it has one, else the shared index (`resolveHybridIndex`). */
  private resolveHybridIndex(tenantId: string, lang: string): Promise<string> {
    return resolveTenantHybridIndex(
      {
        elasticsearch: this.elasticsearchService,
        cache: this.requestCacheService,
        metrics: this.metrics,
        logger: this.logger,
      },
      tenantId,
      lang,
    );
  }
}
