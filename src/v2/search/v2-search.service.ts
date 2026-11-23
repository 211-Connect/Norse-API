import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Span } from '@opentelemetry/api';
import { withSpan, withSpanSync } from 'src/common/tracing/with-span';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { SearchResourcesQueryDto } from 'src/search/dto/search-query.dto';
import {
  HybridSearchResult,
  HybridSearchService,
  NeedScore,
} from 'src/search/hybrid-search.service';
import { decide, finalize, isWeakMatch, weakMatchDecision } from '../rules';
import { isTier1, isTier2 } from '../rules/sune';
import {
  AiClassificationSetting,
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
import { TopAreasService } from './top-areas.service';
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
      // Fallback: the prefix-length error has only a generic type.
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

@Injectable()
export class V2SearchService {
  constructor(
    private readonly classifier: SearchClassificationClient,
    private readonly hybridSearch: HybridSearchService,
    private readonly tenantConfig: TenantConfigService,
    private readonly regionService: RegionService,
    private readonly searchService: SearchService,
    private readonly topAreasService: TopAreasService,
  ) {}

  /**
   * One hybrid search. The language picks the index; an unknown language has
   * no index. That was a 500 (break run 2026-11-14) and is a caller error.
   */
  private runSearch(
    call: HybridCall,
    headers: HeadersDto,
  ): Promise<HybridSearchResult> {
    return this.hybridSearch.searchHybrid(call).catch((error: unknown) => {
      if (isIndexNotFound(error)) {
        throw new BadRequestException(
          `no search index for accept-language ${headers['accept-language']}`,
        );
      }
      if (isQueryTooLarge(error)) {
        throw new BadRequestException('query is too long for search');
      }
      throw error;
    });
  }

  /**
   * Map pins for a v2 search: the same membership as `search` (child taxonomy
   * codes, region), the v1 pins shape. No classify call and no embedding unless
   * `relevance_cutoff=on` needs scores (the v1 pins rule). The region is
   * resolved by `SearchService.searchPins`, the same `resolveArea` as `search`.
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
    return this.searchService
      .searchPins({
        headers,
        query: { ...v1Fields, query_type: 'hybrid' } as SearchResourcesQueryDto,
        rankingVersion: 'v2',
      })
      .catch((error: unknown) => {
        if (isIndexNotFound(error)) {
          throw new BadRequestException(
            `no search index for accept-language ${headers['accept-language']}`,
          );
        }
        if (isQueryTooLarge(error)) {
          throw new BadRequestException('query is too long for search');
        }
        throw error;
      });
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

    // Only caller-sent needs make blocks; a model guess never does. N-X never
    // makes a block. They never filter (Lucas 2026-11-12).
    const callerNeeds = dto.needs ?? [];
    const selectedNeeds = callerNeeds.filter((c) => c !== 'N-X');

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { needs, passed_needs, urgency, clarify, ...v1Fields } = dto;
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

    // Tenant top areas run in parallel with the config read and classify. The
    // service never throws: a failure is [] (engine default areas).
    const topAreasPromise = this.topAreasService.topAreas(
      headers['x-tenant-id'],
      headers['accept-language'],
    );

    // `off`: one classify call still runs for the emergency check; the rules
    // engine drops its need and urgency guesses (question 14). getSearchConfig
    // never throws: a missing or unreadable value is an empty object (on).
    const searchConfig = await withSpan('v2.tenant_config', () =>
      this.tenantConfig.getSearchConfig(headers['x-tenant-id']),
    );
    // Classify is always on for the request (Lucas 2026-11-18): only the tenant
    // setting can turn the need guess off.
    const aiClassification = tenantAiClassification(searchConfig);

    // Classify never throws; a failure comes back as error signals.
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
    const signals = classified?.signals ?? NO_TEXT_SIGNALS;
    const scores = classified?.scores ?? {};

    const lang = headers['accept-language'] || 'en';
    const rulesRequest: RulesRequest = {
      has_text: hasText,
      has_content_word: hasContentWord(text, lang),
      needs: callerNeeds,
      passed_needs: dto.passed_needs ?? [],
      urgency: dto.urgency,
      clarify: dto.clarify ?? 'auto',
    };
    const topAreas = await topAreasPromise;
    const decision = withSpanSync('v2.rules.decide', () =>
      decide(rulesRequest, signals, {
        ai_classification: aiClassification,
        hotlines: tenantHotlines(searchConfig),
        top_areas: topAreas,
      }),
    );

    const needScores: NeedScore[] = [];
    for (const code of decision.boost_needs) {
      const tier = isTier1(code) ? 'tier1' : isTier2(code) ? 'tier2' : null;
      if (!tier) continue;
      const score = callerNeeds.includes(code) ? 1 : scores[code];
      if (typeof score !== 'number') continue;
      needScores.push({ code, tier, score });
    }

    // A used urgency U-1..U-4 lifts services tagged with that level (ISS-2867).
    // U-0 comes only from the emergency check and has no service weights.
    const u = decision.urgency;
    const urgencyScore =
      u.source === 'caller' ? 1 : (signals.urgency?.score ?? 0);
    const urgencyBoost: HybridCall['urgencyBoost'] =
      u.state === 'use' &&
      /^U-[1-4]$/.test(u.value) &&
      Number.isFinite(urgencyScore) &&
      urgencyScore > 0
        ? {
            code: u.value as 'U-1' | 'U-2' | 'U-3' | 'U-4',
            score: urgencyScore,
          }
        : undefined;

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

    const tenantContext = {
      ai_classification: aiClassification,
      hotlines: tenantHotlines(searchConfig),
      top_areas: topAreas,
    };
    const hybridCall: HybridCall = {
      ...retrievalOptions,
      ...(early && { early }),
      ...(area && { area }),
      needScores,
      ...(urgencyBoost && { urgencyBoost }),
      ...(countCodes.length > 0 && { countCodes }),
    };
    // The text-free second call (weak match) starts from this call minus the
    // early handle: the early stage was built for the text query.
    // The text-free second calls (weak match) drop every boost: needScores
    // is set to [] below and the urgency boost is left out here (ISS-2867).
    const {
      early: _early,
      urgencyBoost: _urgencyBoost,
      ...withoutEarly
    } = hybridCall;
    void _early;
    void _urgencyBoost;
    const first = await withSpan('v2.retrieval', () =>
      this.runSearch(hybridCall, headers),
    );
    const {
      judges,
      needCounts: firstCounts,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      totalCounted: _tc1,
      ...firstResponse
    } = first;

    // Weak match (ISS-2796, Lucas 2026-11-18): the text found nothing the
    // judges trust. Not weak when the search returned no judges.
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
        ...secondResponse
      } = second;
      response = secondResponse;
      counts = { total: countedTotal(second), by_code: secondCounts ?? null };
    }

    // strong_text_match is still a placeholder: no retrieval signal yet.
    const clarification = withSpanSync('v2.rules.finalize', () =>
      finalize(clarifyDecision, {
        counts,
        strong_text_match: false,
      }),
    );

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
      model_version: classified?.modelVersion ?? null,
      rules_version: decision.rules_version,
    };
    // A shared cache may store only band none with no emergency question
    // (ADR 0039 Decision 28); the controller's TTL covers the rest.
    return decision.cacheable ? result : markNotStorable(result);
  }
}
