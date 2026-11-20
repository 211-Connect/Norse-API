import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Span } from '@opentelemetry/api';
import { withSpan, withSpanSync } from 'src/common/tracing/with-span';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { SearchResourcesQueryDto } from 'src/search/dto/search-query.dto';
import {
  HybridSearchService,
  NeedScore,
} from 'src/search/hybrid-search.service';
import { decide, finalize } from '../rules';
import { isTier1, isTier2 } from '../rules/sune';
import {
  AiClassificationSetting,
  RulesRequest,
  RulesSignals,
} from '../rules/types';
import { SearchResourcesBodyDto } from 'src/search/dto/search-body.dto';
import { V2SearchQueryDto } from './dto/v2-search-query.dto';
import { V2SearchResponseDto } from './dto/v2-search-response.dto';
import { TenantConfigService } from 'src/cms-config/tenant-config.service';
import { SearchConfigCache } from 'src/cms-config/types/search-config-cache';
import { normalizeQueryText } from '../../search/internal/query-text';
import { SearchClassificationClient } from './search-classification.client';
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
 * the `search_config:<tenant>` Redis value that Payload writes. Off when the
 * tenant's `search_engine` is a known value other than `ai_classification`.
 * Missing, null or unknown is on, so a tenant is never switched off by a gap.
 */
export function tenantAiClassification(
  config: SearchConfigCache | null | undefined,
): AiClassificationSetting {
  const engine = config?.search_engine;
  return engine === 'classic' || engine === 'hybrid' ? 'off' : 'on';
}

/**
 * Off when the tenant setting is off OR the request says `classify=off`.
 * A request can never turn it on.
 */
export function resolveAiClassification(
  tenant: AiClassificationSetting,
  requested: 'off' | undefined,
): AiClassificationSetting {
  return tenant === 'off' || requested === 'off' ? 'off' : 'on';
}

@Injectable()
export class V2SearchService {
  constructor(
    private readonly classifier: SearchClassificationClient,
    private readonly hybridSearch: HybridSearchService,
    private readonly tenantConfig: TenantConfigService,
  ) {}

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
    const { needs, passed_needs, urgency, clarify, classify, ...v1Fields } =
      dto;
    // What retrieval gets that does not depend on classify. It is built once:
    // the early start and the final call use the same values.
    const retrievalOptions = {
      headers,
      query: { ...v1Fields, query_type: 'hybrid' } as SearchResourcesQueryDto,
      rankingVersion: 'v2' as const,
      ...(selectedNeeds.length > 0 && { selectedNeeds }),
      body,
    };
    // Everything in retrieval that does not read the classify result starts
    // now, in parallel with the tenant config read and classify: the embedding,
    // Redis reads, keyword and vector lists, stats and taxonomy lookup. A
    // failure surfaces inside searchHybrid, where the catch below maps it.
    const early = hasText
      ? this.hybridSearch.startEarlyRetrieval(retrievalOptions)
      : undefined;

    // `off`: one classify call still runs for the emergency check; the rules
    // engine drops its need and urgency guesses (question 14). getSearchConfig
    // never throws: a missing or unreadable value is an empty object (on).
    const searchConfig = await withSpan('v2.tenant_config', () =>
      this.tenantConfig.getSearchConfig(headers['x-tenant-id']),
    );
    const aiClassification = resolveAiClassification(
      tenantAiClassification(searchConfig),
      dto.classify,
    );

    // Classify never throws; a failure comes back as error signals.
    const classified = hasText
      ? await withSpan('v2.classify', async (classifySpan) => {
          const result = await this.classifier.classify(
            cutWholeCharacters(
              normalizeQueryText(text),
              CLASSIFY_MAX_TEXT_LENGTH,
            ),
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

    const rulesRequest: RulesRequest = {
      has_text: hasText,
      needs: callerNeeds,
      passed_needs: dto.passed_needs ?? [],
      urgency: dto.urgency,
      clarify: dto.clarify ?? 'auto',
    };
    // Tenant top areas and hotlines: later slice.
    const decision = withSpanSync('v2.rules.decide', () =>
      decide(rulesRequest, signals, {
        ai_classification: aiClassification,
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

    // clarify=never removes the counting cost (ADR 0039 decision 26).
    const countCodes = dto.clarify === 'never' ? [] : decision.count_codes;

    // The language picks the index. An unknown language has no index; that
    // was a 500 (break run 2026-11-14) and is a caller error.
    span.setAttributes({
      'v2.has_text': hasText,
      'v2.ai_classification': aiClassification,
      'v2.boost_needs': needScores.length,
      'v2.selected_needs': selectedNeeds.length,
      'v2.count_codes': countCodes.length,
    });

    const { needCounts, totalCounted, ...response } = await withSpan(
      'v2.retrieval',
      () =>
        this.hybridSearch.searchHybrid({
          ...retrievalOptions,
          ...(early && { early }),
          needScores,
          ...(countCodes.length > 0 && { countCodes }),
        }),
    ).catch((error: unknown) => {
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

    // by_code null means "not counted" (clarify=never, no codes asked, or the
    // count failed): every option is kept. An object means "counted"; the
    // search fills 0 for each requested code the aggregation omits.
    // strong_text_match is still a placeholder: no retrieval signal yet.
    const clarification = withSpanSync('v2.rules.finalize', () =>
      finalize(decision, {
        counts: {
          total: totalCounted === false ? null : hitsTotal(response),
          by_code: needCounts ?? null,
        },
        strong_text_match: false,
      }),
    );

    const result: V2SearchResponseDto = {
      ...response,
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
