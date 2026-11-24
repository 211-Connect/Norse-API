import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Span } from '@opentelemetry/api';
import { withSpan, withSpanSync } from 'src/common/tracing/with-span';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { SearchResourcesQueryDto } from 'src/search/dto/search-query.dto';
import {
  HybridSearchResult,
  HybridSearchService,
  isBoostableUrgency,
  NeedScore,
} from 'src/search/hybrid-search.service';
import { envFlag } from '../../common/config/configuration';
import * as rules from '../rules';
import * as legacyRules from '../rules/legacy';
import { MATCH, Match, matchOf } from '../rules/match';
import { isNamed, nameWords } from 'src/search/internal/name-match/name-match';
import { hitText } from 'src/search/internal/text-matching/hit-text';
import { needDescription } from '../rules/need-text';
import { toContractClarification } from '../rules/contract';
import {
  floorOnlyEmergency,
  isFullV2Locale,
  localizeClarification,
} from '../rules/localize';
import { isTier1, isTier2 } from '../rules/sune';
import {
  AiClassificationSetting,
  FinalizeInput,
  RulesRequest,
  RulesSignals,
  Hotline,
} from '../rules/types';
import { SearchResourcesBodyDto } from 'src/search/dto/search-body.dto';
import { V2SearchQueryDto } from './dto/v2-search-query.dto';
import { V2SearchResponseDto } from './dto/v2-search-response.dto';
import { TenantConfigService } from 'src/cms-config/tenant-config.service';
import { SearchConfigCache } from 'src/cms-config/types/search-config-cache';
import { SearchClassificationClient } from './search-classification.client';
import { contentWords } from 'src/search/internal/text-matching/word-rarity';
import { modelText } from './model-text';
import { RegionService } from 'src/region/internal';
import { SearchService } from 'src/search/search.service';
import { SearchPinsResponseDto } from 'src/search/dto/search-pins-response.dto';
import { resolveArea } from 'src/search/internal/area/resolve-area';
import { markNotStorable } from 'src/common/interceptors/cdn-cache-control.interceptor';

// Signals when there is no typed text: nothing to classify. `emergency: null`
// means the check did not run (same as the rules engine's own specs).
const NO_TEXT_SIGNALS: RulesSignals = {
  needs: { status: 'ok', scores: {} },
  emergency: null,
};

const totalLogger = new Logger('V2SearchService');

/**
 * Hit total, or `null` ("not counted") when Elasticsearch sent a shape that
 * cannot be read. 0 would be wrong: finalize drops every needs question at 0.
 * Logs the shape type only, never the query (David, PR #279 review).
 */
const hitsTotal = (response: {
  search?: { hits?: { total?: unknown } };
}): number | null => {
  const total = response.search?.hits?.total;
  if (typeof total === 'number' && Number.isFinite(total)) return total;
  const value = (total as { value?: unknown } | null | undefined)?.value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  totalLogger.warn(
    `hits.total unreadable (${total === null ? 'null' : typeof total}); treated as not counted`,
  );
  return null;
};

/**
 * Hit total for the clarify counts: `null` ("not counted") when searchHybrid
 * flagged the total as unreadable (`totalCounted: false`), else `hitsTotal`.
 */
const countedTotal = (response: {
  totalCounted?: false;
  search?: { hits?: { total?: unknown } };
}): number | null =>
  response.totalCounted === false ? null : hitsTotal(response);

/** The page is cut short (timeout, failed shard), or its total or the count read failed. */
const isPartial = ({
  search,
  needCountsFailed,
  totalCounted,
}: Pick<
  HybridSearchResult,
  'search' | 'needCountsFailed' | 'totalCounted'
>): boolean =>
  search.timed_out ||
  search._shards.failed > 0 ||
  totalCounted === false ||
  needCountsFailed === true;

// ml-broker rejects classify text longer than 512 characters after stripping
// (422). See ml-broker/src/tasks/search_classification/schemas.py. A longer
// text would turn into error signals and hide the emergency band, so the text
// sent to classify is cut to this length. The search itself uses the full query.
export const CLASSIFY_MAX_TEXT_LENGTH = 512;

/**
 * At most `max` UTF-16 units, never ending on the first half of a surrogate
 * pair: half an emoji is not valid text for ml-broker, and a failed classify
 * hides the emergency band (David, PR #279 review).
 */
function cutWholeCharacters(text: string, max: number): string {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  const splitsPair = last >= 0xd800 && last <= 0xdbff;
  return text.slice(0, splitsPair ? max - 1 : max);
}

// Filler the function-word lists do not hold ("ok" is not a stop word in
// search, so it is kept out of the shared lists). Only this check reads it.
const FILLER_WORDS = new Set(['ok', 'okay']);

/**
 * True when the text has a content word: a token with 2 or more letters
 * (Unicode letters; digits-only does not count) that is not a function word of
 * the request language. A language with no list counts any such token. The soft
 * emergency card needs one (Lucas 2026-11-17): "i", "ok", "123" and "?" get no card.
 */
export function hasContentWord(text: string, lang: string): boolean {
  return contentWords(text, lang).some(
    (w) => !FILLER_WORDS.has(w) && /\p{L}.*\p{L}/u.test(w),
  );
}

const TOO_COMPLEX_TYPE = 'too_complex_to_determinize_exception';

/** Elasticsearch said the index does not exist (`hybrid_search_resources_<lang>`). */
function isIndexNotFound(error: unknown): boolean {
  const body = (error as { meta?: { body?: { error?: { type?: unknown } } } })
    ?.meta?.body;
  return body?.error?.type === 'index_not_found_exception';
}

/**
 * Elasticsearch refused to build the query because the text is too large: a
 * prefix longer than index.max_regex_length (1000), or a prefix automaton with
 * more than 1000 states (non-ASCII text reaches it under 1000 characters).
 */
function isQueryTooLarge(error: unknown): boolean {
  const err = (
    error as {
      meta?: {
        body?: {
          error?: {
            root_cause?: { type?: unknown; reason?: unknown }[];
            caused_by?: { type?: unknown };
          };
        };
      };
    }
  )?.meta?.body?.error;
  const causes = err?.root_cause;
  if (err?.caused_by?.type === TOO_COMPLEX_TYPE) return true;
  if (!Array.isArray(causes)) return false;
  return causes.some(
    (c) =>
      c?.type === TOO_COMPLEX_TYPE ||
      // Message match kept on purpose: Elasticsearch gives the prefix-length
      // and automaton-size errors only the generic `query_shard_exception`
      // type, which also covers unrelated query errors. No narrower type exists.
      (typeof c?.reason === 'string' &&
        (c.reason.includes('automaton is too large') ||
          c.reason.includes('has exceeded the allowed maximum'))),
  );
}

/**
 * Tenant setting "AI classification off" (ADR 0039 Decisions 52, 60), read from
 * the `ai_classification` field of the `search_config:<tenant>` Redis value.
 * v2 has its own field: the v1 `search_engine` (classic or hybrid) must not
 * switch v2 AI off. Only exactly `off` is off; missing, null or unknown is on,
 * so a tenant is never switched off by a gap.
 */
export function tenantAiClassification(
  config: SearchConfigCache | null | undefined,
): AiClassificationSetting {
  return config?.ai_classification === 'off' ? 'off' : 'on';
}

const MAX_HOTLINES = 4;

/**
 * Tenant hotlines from `search_config:<tenant>` (ADR 0039: shown only in the
 * emergency question). Keeps entries with a non-empty label and number, trimmed,
 * at most 4, in order. Anything malformed gives [], and the rules engine then
 * uses its default hotlines (988 and 911).
 */
export function tenantHotlines(
  config: SearchConfigCache | null | undefined,
): Hotline[] {
  const raw: unknown = config?.hotlines;
  if (!Array.isArray(raw)) return [];
  const out: Hotline[] = [];
  for (const item of raw) {
    const { label, number } = (item ?? {}) as Record<string, unknown>;
    if (typeof label !== 'string' || typeof number !== 'string') continue;
    const l = label.trim();
    const n = number.trim();
    if (l && n) out.push({ label: l, number: n });
    if (out.length === MAX_HOTLINES) break;
  }
  return out;
}

type HybridCall = Parameters<HybridSearchService['searchHybrid']>[0];

/**
 * The rules engine for this request. `V2_QUESTION_RULE_V1=true` runs the
 * question rule v1 (`../rules`); anything else runs the verbatim copy of
 * development's engine (`../rules/legacy`), so "off" is today's behavior.
 * The legacy types differ a little: the cast is at this boundary.
 */
type RulesEngine = Pick<
  typeof rules,
  'decide' | 'finalize' | 'isWeakMatch' | 'weakMatchDecision'
>;
const NEW_ENGINE: RulesEngine = rules;
const legacyEngine = legacyRules as unknown as RulesEngine;
// Development's finalize takes `{ counts, strong_text_match }`; the field is
// not in the new input. The wrapper adds it (always false), at the cast boundary.
const LEGACY_ENGINE: RulesEngine = {
  ...legacyEngine,
  finalize: (decision, input) =>
    legacyEngine.finalize(decision, {
      counts: input.counts,
      strong_text_match: false,
    } as FinalizeInput),
};

/** The texts of a result page's top hits. */
export function topTexts(response: {
  search?: { hits?: { hits?: unknown[] } };
}): string[] {
  return (response.search?.hits?.hits ?? [])
    .slice(0, MATCH.topN)
    .map((h) => hitText((h as { _source?: unknown })._source));
}

/** A weak match shows no results, no facets and no relevance cut (Lucas 2026-11-18). */
function emptyResults<T extends HybridSearchResult>(
  response: Omit<T, 'needCounts' | 'judges'>,
): Omit<T, 'needCounts' | 'judges' | 'relevance_cutoff'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { relevance_cutoff, ...rest } = response as Record<string, unknown>;
  return {
    ...rest,
    search: {
      ...(response as HybridSearchResult).search,
      hits: {
        total: { value: 0, relation: 'eq' },
        max_score: null,
        hits: [],
      },
    },
    facets: [],
  } as never;
}

/**
 * An Elasticsearch failure that the caller caused becomes a 400: an unknown
 * language has no index, and a too-large query text cannot be built. Any other
 * error is rethrown unchanged.
 */
function throwCallerError(error: unknown, headers: HeadersDto): never {
  if (isIndexNotFound(error)) {
    throw new BadRequestException(
      `no search index for accept-language ${headers['accept-language']}`,
    );
  }
  if (isQueryTooLarge(error)) {
    throw new BadRequestException('query is too long for search');
  }
  throw error;
}

/**
 * A used urgency U-1..U-4 lifts services tagged with that level (ISS-2867).
 * U-0 comes only from the emergency check and has no service weights. Shared
 * by the list and the pins, so both rank the same kept set.
 */
function urgencyBoostOf(
  decision: { urgency: { source?: string; state: string; value: string } },
  signals: { urgency?: { score?: number } | null },
): HybridCall['urgencyBoost'] {
  const u = decision.urgency;
  const urgencyScore =
    u.source === 'caller' ? 1 : (signals.urgency?.score ?? 0);
  return u.state === 'use' && isBoostableUrgency(u.value, urgencyScore)
    ? { code: u.value, score: urgencyScore }
    : undefined;
}

@Injectable()
export class V2SearchService {
  constructor(
    private readonly classifier: SearchClassificationClient,
    private readonly hybridSearch: HybridSearchService,
    private readonly tenantConfig: TenantConfigService,
    private readonly regionService: RegionService,
    private readonly searchService: SearchService,
    private readonly configService: ConfigService,
  ) {}

  /** Question rule v1 switch, read per request (off = development's engine). */
  private ruleV1(): boolean {
    return envFlag(
      this.configService.get<string>('V2_QUESTION_RULE_V1'),
      false,
    );
  }

  /** Question rule v1: the words the keyword list may name an org by. The list and the pins use the same. */
  private orgWordsOf(text: string, headers: HeadersDto): string[] {
    return this.ruleV1()
      ? nameWords(contentWords(text, headers['accept-language'] || 'en'))
      : [];
  }

  /**
   * One hybrid search. The language picks the index; an unknown language has
   * no index. That was a 500 (break run 2026-11-14) and is a caller error.
   */
  private runSearch(
    call: HybridCall,
    headers: HeadersDto,
  ): Promise<HybridSearchResult> {
    return this.hybridSearch
      .searchHybrid(call)
      .catch((error: unknown) => throwCallerError(error, headers));
  }

  /**
   * Map pins for a v2 search: the same membership as `search` (child taxonomy
   * codes, region, and for a text query the same kept set), the v1 pins
   * shape. A text query classifies, so the need list matches `search`; an
   * empty query makes no classify call. The region is resolved by
   * `SearchService.searchPins`, the same `resolveArea` as `search`. Weak match
   * is not checked on pins (known limit).
   */
  async pins({
    headers,
    query: dto,
  }: {
    headers: HeadersDto;
    query: V2SearchQueryDto;
  }): Promise<SearchPinsResponseDto> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { needs, passed_needs, urgency, clarify, ...v1Fields } = dto;
    const text = dto.query;
    const orgWords = this.orgWordsOf(text, headers);
    let needScores: NeedScore[] | undefined;
    let urgencyBoost: HybridCall['urgencyBoost'];
    if (text.trim().length > 0) {
      const searchConfig = await this.tenantConfig.getSearchConfig(
        headers['x-tenant-id'],
      );
      const decided = await this.classifyAndDecide({
        headers,
        dto,
        text,
        searchConfig,
      });
      needScores = decided.needScores;
      // The same urgency as the list, so the pins come from the same kept set.
      urgencyBoost = urgencyBoostOf(decided.decision, decided.signals);
    }
    return this.searchService
      .searchPins({
        headers,
        query: { ...v1Fields, query_type: 'hybrid' } as SearchResourcesQueryDto,
        rankingVersion: 'v2',
        ...(needScores && { needScores }),
        ...(urgencyBoost && { urgencyBoost }),
        ...(orgWords.length > 0 && { nameWords: orgWords }),
      })
      .catch((error: unknown) => throwCallerError(error, headers));
  }

  /**
   * Classify the text, then run the rules to decide the need boosts. Shared by
   * `run` and `pins`, so the pins need list equals the search page need list.
   * Classify never throws; a failure comes back as error signals.
   */
  private async classifyAndDecide({
    headers,
    dto,
    text,
    searchConfig,
  }: {
    headers: HeadersDto;
    dto: V2SearchQueryDto;
    text: string;
    searchConfig: SearchConfigCache;
  }) {
    const hasText = text.trim().length > 0;
    const callerNeeds = dto.needs ?? [];
    const ruleV1 = this.ruleV1();
    const { decide } = ruleV1 ? NEW_ENGINE : LEGACY_ENGINE;
    // Classify is always on for the request (Lucas 2026-11-18): only the tenant
    // setting can turn the need guess off. Full v2 features only for en and es
    // (Lucas 2026-11-20): any other locale runs with AI classification off (no
    // need or urgency guesses, no need questions) and shows the danger question
    // only on a keyword-floor hit. The list and the map pins both come through
    // here, so they follow the same rule.
    const lang = headers['accept-language'] || 'en';
    const limitedLocale = !isFullV2Locale(lang);
    const aiClassification: AiClassificationSetting = limitedLocale
      ? 'off'
      : tenantAiClassification(searchConfig);
    const classified = hasText
      ? await withSpan('v2.classify', async (classifySpan) => {
          const result = await this.classifier.classify(
            cutWholeCharacters(modelText(text), CLASSIFY_MAX_TEXT_LENGTH),
            headers['x-tenant-id'],
            aiClassification,
          );
          // Classify never throws; error signals mark a failed call.
          classifySpan.setAttribute(
            'v2.classify.failed',
            result.signals.emergency?.status === 'error',
          );
          return result;
        })
      : null;
    const classifiedSignals = classified?.signals ?? NO_TEXT_SIGNALS;
    const signals = limitedLocale
      ? floorOnlyEmergency(classifiedSignals)
      : classifiedSignals;
    const scores = classified?.scores ?? {};

    const rulesRequest: RulesRequest = {
      has_text: hasText,
      has_content_word: hasContentWord(text, lang),
      needs: callerNeeds,
      passed_needs: dto.passed_needs ?? [],
      urgency: dto.urgency,
      clarify: dto.clarify ?? 'auto',
      ...(ruleV1 && {
        query: hasText ? modelText(text) : undefined,
        content_words: contentWords(text, lang),
      }),
    };
    // One context for every rules call of the request (decide, weak match).
    const tenantContext: rules.TenantContext = {
      ai_classification: aiClassification,
      hotlines: tenantHotlines(searchConfig),
      locale: lang,
    };
    const decision = withSpanSync('v2.rules.decide', () =>
      decide(rulesRequest, signals, tenantContext),
    );

    const needScores: NeedScore[] = [];
    for (const code of decision.boost_needs) {
      const tier = isTier1(code) ? 'tier1' : isTier2(code) ? 'tier2' : null;
      if (!tier) continue;
      const score = callerNeeds.includes(code) ? 1 : scores[code];
      if (typeof score !== 'number') continue;
      needScores.push({ code, tier, score });
    }
    return {
      signals,
      rulesRequest,
      decision,
      needScores,
      modelVersion: classified?.modelVersion ?? null,
      aiClassification,
      tenantContext,
      ruleV1,
    };
  }

  /** One `v2.search` span over the whole pipeline; each step is a child. */
  search(args: {
    headers: HeadersDto;
    query: V2SearchQueryDto;
    body?: SearchResourcesBodyDto;
  }): Promise<V2SearchResponseDto> {
    return withSpan('v2.search', (span) => this.run(args, span));
  }

  private async run(
    {
      headers,
      query: dto,
      body,
    }: {
      headers: HeadersDto;
      query: V2SearchQueryDto;
      body?: SearchResourcesBodyDto;
    },
    span: Span,
  ): Promise<V2SearchResponseDto> {
    // V2SearchQueryDto guarantees a string: an array or AND/OR object is a 400.
    const text = dto.query;
    const hasText = text.trim().length > 0;
    const lang = headers['accept-language'] || 'en';

    // Only caller-sent needs make blocks; a model guess never does. N-X never
    // makes a block. They never filter (Lucas 2026-11-12).
    const callerNeeds = dto.needs ?? [];
    const selectedNeeds = callerNeeds.filter((c) => c !== 'N-X');

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { needs, passed_needs, urgency, clarify, ...v1Fields } = dto;
    const orgWords = this.orgWordsOf(text, headers);
    // What retrieval gets that does not depend on classify. It is built once:
    // the early start and the final call use the same values.
    const retrievalOptions = {
      headers,
      query: {
        ...v1Fields,
        // The keyword search and the embedding get the same text form as the
        // classifier: extra spaces and a trailing ? changed the top 10 of 15 of
        // 40 queries even after the models were normalized (ISS-2797, 2026-11-18).
        ...(hasText && { query: modelText(text) }),
        query_type: 'hybrid',
        // Off by default (DTO); a browse has nothing to trim, so it stays off.
        ...(!hasText && { relevance_cutoff: 'off' }),
      } as SearchResourcesQueryDto,
      rankingVersion: 'v2' as const,
      ...(selectedNeeds.length > 0 && { selectedNeeds }),
      body,
      ...(orgWords.length > 0 && { nameWords: orgWords }),
    };
    // Everything in retrieval that does not read the classify result starts
    // now, in parallel with the tenant config read and classify: the embedding,
    // Redis reads, keyword and vector lists, stats and taxonomy lookup. A
    // failure surfaces inside searchHybrid, where the catch below maps it.
    // An area search resolves its Region after the tenant config read, and the
    // early stage builds its filters without it, so an area search starts
    // nothing early.
    const early =
      hasText && !dto.region
        ? this.hybridSearch.startEarlyRetrieval(retrievalOptions)
        : undefined;

    // `off`: one classify call still runs for the emergency check; the rules
    // engine drops its need and urgency guesses (question 14). getSearchConfig
    // never throws: a missing or unreadable value is an empty object (on).
    const searchConfig = await withSpan('v2.tenant_config', () =>
      this.tenantConfig.getSearchConfig(headers['x-tenant-id']),
    );
    const {
      signals,
      rulesRequest,
      decision,
      needScores,
      modelVersion,
      aiClassification,
      tenantContext,
      ruleV1,
    } = await this.classifyAndDecide({
      headers,
      dto,
      text,
      searchConfig,
    });

    const urgencyBoost = urgencyBoostOf(decision, signals);

    // clarify=never removes the counting cost (ADR 0039 decision 26).
    const countCodes = dto.clarify === 'never' ? [] : decision.count_codes;

    // An area search (`region`, PR #313): an unknown Region is a 400 before
    // the search runs. The tenant config read above gives the defaults.
    const { area, resolved } = await resolveArea(
      dto,
      this.regionService,
      async () => searchConfig,
      { rankingVersion: 'v2' },
    );

    // The language picks the index. An unknown language has no index; that
    // was a 500 (break run 2026-11-14) and is a caller error.
    span.setAttributes({
      'v2.has_text': hasText,
      'v2.ai_classification': aiClassification,
      'v2.boost_needs': needScores.length,
      'v2.urgency_boost': urgencyBoost?.code ?? 'none',
      'v2.selected_needs': selectedNeeds.length,
      'v2.count_codes': countCodes.length,
    });

    const hybridCall: HybridCall = {
      ...retrievalOptions,
      ...(early && { early }),
      ...(area && { area }),
      needScores,
      ...(urgencyBoost && { urgencyBoost }),
      ...(countCodes.length > 0 && { countCodes }),
      // Question rule v1 only: a tenant with no need tags counts as "not
      // counted".
      ...(ruleV1 && { nullCountsWithoutNeedTags: true }),
    };
    // The text-free second call (weak match) starts from this call minus the
    // early handle: the early stage was built for the text query.
    // The text-free second calls (weak match) drop every boost: needScores
    // is set to [] below and the urgency boost is left out here (ISS-2867).
    const {
      early: _early,
      urgencyBoost: _urgencyBoost,
      nameWords: _nameWords,
      ...withoutEarly
    } = hybridCall;
    void _early;
    void _urgencyBoost;
    void _nameWords;
    const first = await withSpan('v2.retrieval', () =>
      this.runSearch(hybridCall, headers),
    );
    const {
      judges,
      needCounts: firstCounts,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      totalCounted: _tc1,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      needCountsFailed: _cf1,
      nameClaim,
      ...firstResponse
    } = first;

    // Weak match (ISS-2796, Lucas 2026-11-18): the text found nothing the
    // judges trust. Not weak when the search returned no judges.
    const { finalize, isWeakMatch, weakMatchDecision } = ruleV1
      ? NEW_ENGINE
      : LEGACY_ENGINE;
    const weak = isWeakMatch({
      req: rulesRequest,
      signals,
      ai: aiClassification,
      judges: judges ?? null,
      has_content_word_raw: contentWords(text, lang).length > 0,
    });

    // The fields below are what the response builder reads; each branch sets them.
    let response: Omit<
      HybridSearchResult,
      'needCounts' | 'judges' | 'totalCounted'
    > = firstResponse;
    let clarifyDecision = decision;
    let partial = isPartial(first);
    let counts: {
      total: number | null;
      by_code: Record<string, number> | null;
    } = {
      total: countedTotal(first),
      // by_code null means "not counted" (clarify=never, no codes asked, or
      // the count failed): every option is kept. An object means "counted";
      // the search fills 0 for each requested code the aggregation omits.
      by_code: firstCounts ?? null,
    };

    if (weak && callerNeeds.length === 0) {
      // No pick yet: no results, and a no_match question. The counts come
      // from a text-free call over the question's need codes.
      clarifyDecision = weakMatchDecision(
        decision,
        rulesRequest,
        tenantContext,
      );
      response = emptyResults(firstResponse);
      counts = { total: 0, by_code: null };
      if (clarifyDecision.count_codes.length > 0) {
        const second = await withSpan('v2.retrieval.weak_counts', () =>
          this.runSearch(
            {
              ...withoutEarly,
              query: {
                ...hybridCall.query,
                query: '',
                relevance_cutoff: 'off',
                limit: 1,
                page: 1,
              } as SearchResourcesQueryDto,
              needScores: [],
              selectedNeeds: undefined,
              countCodes: clarifyDecision.count_codes,
            },
            headers,
          ),
        );
        partial ||= isPartial(second);
        counts = {
          total: countedTotal(second),
          by_code: second.needCounts ?? null,
        };
      }
    } else if (weak) {
      // The caller picked needs after a weak match: the text is dropped and
      // the need tags decide (hard filter).
      const second = await withSpan('v2.retrieval.weak_pick', () =>
        this.runSearch(
          {
            ...withoutEarly,
            query: {
              ...hybridCall.query,
              query: '',
              relevance_cutoff: 'off',
            } as SearchResourcesQueryDto,
            needScores: [],
            needFilter: callerNeeds,
          },
          headers,
        ),
      );
      const {
        needCounts: secondCounts,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        judges: _j,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        totalCounted: _tc2,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        needCountsFailed: _cf2,
        ...secondResponse
      } = second;
      response = secondResponse;
      partial ||= isPartial(second);
      counts = { total: countedTotal(second), by_code: secondCounts ?? null };
    }

    // Question rule v1: what the returned hits say about the query. Only the
    // first relevance page is the top of the kept set; on any other page or
    // sort the words held say nothing (only a name counts). A limited locale
    // gets no need question, so no notice either.
    const topPage =
      (dto.page ?? 1) === 1 &&
      (dto.sort ?? 'relevance') === 'relevance' &&
      isFullV2Locale(lang);
    let match: Match | undefined;
    // Read for every answer, also a pick after a weak match: the failed list
    // decided that it was weak.
    const nameFailed =
      ruleV1 && orgWords.length > 0 && nameClaim?.status !== 'ok';
    // No text (browse): no match; finalize reads it as `spread`.
    // A pick after a weak match dropped the text: the page says nothing about it.
    const weakPick = weak && callerNeeds.length > 0;
    if (ruleV1 && hasText && !weakPick) {
      match = matchOf({
        words: rulesRequest.content_words ?? [],
        texts: topPage ? topTexts(response) : [],
        named: isNamed(nameClaim),
      });
      span.setAttributes({
        'v2.match': match,
        'v2.match.name':
          orgWords.length === 0
            ? 'skipped'
            : nameFailed
              ? 'failed'
              : nameClaim!.veto
                ? `veto_${nameClaim!.veto}`
                : nameClaim!.org_ids.length > 0
                  ? 'named'
                  : isNamed(nameClaim)
                    ? 'named_service'
                    : 'none',
      });
    }
    // Off: LEGACY_ENGINE reads `counts` only (it adds its own strong_text_match).
    const finalizeInput: FinalizeInput = ruleV1
      ? {
          counts,
          ...(match && { match }),
          // The pick has its own results: not the no-results rule.
          weak: weak && !weakPick,
        }
      : { counts };
    if (ruleV1) {
      span.setAttribute(
        'v2.grid_rule',
        rules.gridRule(clarifyDecision, finalizeInput),
      );
    }
    // English passes through unchanged; es vi ru ko am zh-hans get a string table.
    const localized = withSpanSync('v2.rules.finalize', () =>
      localizeClarification(finalize(clarifyDecision, finalizeInput), lang),
    );
    // Question contract v2 (on): the engine's own measures stay in the trace,
    // not in the response.
    if (ruleV1) {
      span.setAttribute(
        'v2.questions',
        localized.questions
          .map((q) =>
            [q.id, q.importance, q.reason, q.value, q.uncertainty].join('|'),
          )
          .join(','),
      );
    }
    const clarification = ruleV1
      ? toContractClarification(localized)
      : localized;

    const result: V2SearchResponseDto = {
      ...response,
      weak_match: weak,
      ...(resolved && { resolved_location: resolved }),
      intent: {
        query: hasText ? text : null,
        ...(dto.taxonomy &&
          dto.taxonomy.length > 0 && {
            taxonomy: dto.taxonomy.map((value) => ({
              value,
              source: 'caller' as const,
            })),
          }),
        needs: decision.needs.map((n) => ({
          value: n.code,
          source: n.source,
          state: n.state,
          ...(n.confidence !== undefined && { confidence: n.confidence }),
          // Need descriptions (ADR 0039 Decision 31) are new behavior: switch on only.
          ...(ruleV1 &&
            needDescription(n.code, { locale: tenantContext.locale })),
        })),
        urgency: {
          value: decision.urgency.value,
          source: decision.urgency.source,
          state: decision.urgency.state,
        },
      },
      // No top-level emergency block (ADR 0039 Decision 54): the emergency
      // lives only in the emergency question inside `clarification`.
      clarification,
      model_version: modelVersion,
      rules_version: decision.rules_version,
    };
    // A shared cache may store only band none with no emergency question
    // (ADR 0039 Decision 28); the controller's TTL covers the rest.
    // Never cache a degraded result: a failed name match, or a page or count
    // read that Elasticsearch cut short (the match and the options come from it).
    const degraded = nameFailed || (ruleV1 && partial);
    return decision.cacheable && !degraded ? result : markNotStorable(result);
  }
}
