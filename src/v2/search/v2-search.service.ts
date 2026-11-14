import { BadRequestException, Injectable } from '@nestjs/common';
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
import { SearchClassificationClient } from './search-classification.client';

// Signals when there is no typed text: nothing to classify. `emergency: null`
// means the check did not run (same as the rules engine's own specs).
const NO_TEXT_SIGNALS: RulesSignals = {
  needs: { status: 'ok', scores: {} },
  emergency: null,
};

const hitsTotal = (response: { search?: { hits?: { total?: unknown } } }) => {
  const total = response.search?.hits?.total;
  if (typeof total === 'number') return total;
  const value = (total as { value?: number } | undefined)?.value;
  return typeof value === 'number' ? value : 0;
};

// ml-broker rejects classify text longer than 512 characters after stripping
// (422). See ml-broker/src/tasks/search_classification/schemas.py. A longer
// text would turn into error signals and hide the emergency band, so the text
// sent to classify is cut to this length. The search itself uses the full query.
export const CLASSIFY_MAX_TEXT_LENGTH = 512;

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
  const causes = (
    error as {
      meta?: { body?: { error?: { root_cause?: { reason?: unknown }[] } } };
    }
  )?.meta?.body?.error?.root_cause;
  if (!Array.isArray(causes)) return false;
  return causes.some(
    (c) =>
      typeof c?.reason === 'string' &&
      (c.reason.includes('automaton is too large') ||
        c.reason.includes('has exceeded the allowed maximum')),
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

  async search({
    headers,
    query: dto,
    body,
  }: {
    headers: HeadersDto;
    query: V2SearchQueryDto;
    body?: SearchResourcesBodyDto;
  }): Promise<V2SearchResponseDto> {
    // `off`: one classify call still runs for the emergency check; the rules
    // engine drops its need and urgency guesses (question 14). getSearchConfig
    // never throws: a missing or unreadable value is an empty object (on).
    const searchConfig = await this.tenantConfig.getSearchConfig(
      headers['x-tenant-id'],
    );
    const aiClassification = resolveAiClassification(
      tenantAiClassification(searchConfig),
      dto.classify,
    );

    // Only a string with text classifies. A string array or an AND/OR object
    // is a v1 query shape and has no text for the model.
    const text = typeof dto.query === 'string' ? dto.query : '';
    const hasText = text.trim().length > 0;

    // Classify never throws; a failure comes back as error signals.
    const classified = hasText
      ? await this.classifier.classify(
          text.trim().slice(0, CLASSIFY_MAX_TEXT_LENGTH),
          headers['x-tenant-id'],
          aiClassification,
        )
      : null;
    const signals = classified?.signals ?? NO_TEXT_SIGNALS;
    const scores = classified?.scores ?? {};

    const callerNeeds = dto.needs ?? [];
    const rulesRequest: RulesRequest = {
      has_text: hasText,
      needs: callerNeeds,
      passed_needs: dto.passed_needs ?? [],
      urgency: dto.urgency,
      clarify: dto.clarify ?? 'auto',
    };
    // Tenant top areas and hotlines: later slice.
    const decision = decide(rulesRequest, signals, {
      ai_classification: aiClassification,
    });

    const needScores: NeedScore[] = [];
    for (const code of decision.boost_needs) {
      const tier = isTier1(code) ? 'tier1' : isTier2(code) ? 'tier2' : null;
      if (!tier) continue;
      const score = callerNeeds.includes(code) ? 1 : scores[code];
      if (typeof score !== 'number') continue;
      needScores.push({ code, tier, score });
    }

    // Only caller-sent needs make blocks; a model guess never does. N-X never
    // makes a block. They never filter (Lucas 2026-11-12).
    const selectedNeeds = callerNeeds.filter((c) => c !== 'N-X');
    // clarify=never removes the counting cost (ADR 0039 decision 26).
    const countCodes = dto.clarify === 'never' ? [] : decision.count_codes;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { needs, passed_needs, urgency, clarify, classify, ...v1Fields } =
      dto;
    // The language picks the index. An unknown language has no index; that
    // was a 500 (break run 2026-11-14) and is a caller error.
    const { needCounts, ...response } = await this.hybridSearch
      .searchHybrid({
        headers,
        query: { ...v1Fields, query_type: 'hybrid' } as SearchResourcesQueryDto,
        rankingVersion: 'v2',
        needScores,
        ...(selectedNeeds.length > 0 && { selectedNeeds }),
        ...(countCodes.length > 0 && { countCodes }),
        body,
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

    // by_code null means "not counted" (clarify=never, no codes asked, or the
    // count failed): every option is kept. An object means "counted"; the
    // search fills 0 for each requested code the aggregation omits.
    // strong_text_match is still a placeholder: no retrieval signal yet.
    const clarification = finalize(decision, {
      counts: { total: hitsTotal(response), by_code: needCounts ?? null },
      strong_text_match: false,
    });

    return {
      ...response,
      intent: {
        query: hasText ? text : null,
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
  }
}
