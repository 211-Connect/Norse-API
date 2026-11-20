import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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
  Hotline,
} from '../rules/types';
import { SearchResourcesBodyDto } from 'src/search/dto/search-body.dto';
import { V2SearchQueryDto } from './dto/v2-search-query.dto';
import { V2SearchResponseDto } from './dto/v2-search-response.dto';
import { TenantConfigService } from 'src/cms-config/tenant-config.service';
import { SearchConfigCache } from 'src/cms-config/types/search-config-cache';
import { SearchClassificationClient } from './search-classification.client';
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

  async search({
    headers,
    query: dto,
    body,
  }: {
    headers: HeadersDto;
    query: V2SearchQueryDto;
    body?: SearchResourcesBodyDto;
  }): Promise<V2SearchResponseDto> {
    // V2SearchQueryDto guarantees a string: an array or AND/OR object is a 400.
    const text = dto.query;
    const hasText = text.trim().length > 0;

    // The embedding starts before classify so the two run in parallel.
    const queryVector = hasText
      ? this.hybridSearch.startEmbedding(text)
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
    const searchConfig = await this.tenantConfig.getSearchConfig(
      headers['x-tenant-id'],
    );
    // Classify is always on for the request (Lucas 2026-11-18): only the tenant
    // setting can turn the need guess off.
    const aiClassification = tenantAiClassification(searchConfig);

    // Classify never throws; a failure comes back as error signals.
    const classified = hasText
      ? await this.classifier.classify(
          cutWholeCharacters(text.trim(), CLASSIFY_MAX_TEXT_LENGTH),
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
    const decision = decide(rulesRequest, signals, {
      ai_classification: aiClassification,
      hotlines: tenantHotlines(searchConfig),
      top_areas: await topAreasPromise,
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

    // An area search (`region`, PR #313): an unknown Region is a 400 before
    // the search runs. The tenant config read above gives the defaults.
    const { area, resolved } = await resolveArea(
      dto,
      this.regionService,
      async () => searchConfig,
      { rankingVersion: 'v2' },
    );

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { needs, passed_needs, urgency, clarify, ...v1Fields } = dto;
    // The language picks the index. An unknown language has no index; that
    // was a 500 (break run 2026-11-14) and is a caller error.
    const { needCounts, totalCounted, ...response } = await this.hybridSearch
      .searchHybrid({
        headers,
        query: { ...v1Fields, query_type: 'hybrid' } as SearchResourcesQueryDto,
        rankingVersion: 'v2',
        ...(queryVector && { queryVector }),
        needScores,
        ...(selectedNeeds.length > 0 && { selectedNeeds }),
        ...(countCodes.length > 0 && { countCodes }),
        ...(area && { area }),
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
      counts: {
        total: totalCounted === false ? null : hitsTotal(response),
        by_code: needCounts ?? null,
      },
      strong_text_match: false,
    });

    const result: V2SearchResponseDto = {
      ...response,
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
