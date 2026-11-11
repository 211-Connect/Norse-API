import { Injectable } from '@nestjs/common';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { SearchResourcesQueryDto } from 'src/search/dto/search-query.dto';
import {
  HybridSearchService,
  NeedScore,
} from 'src/search/hybrid-search.service';
import { decide, finalize } from '../rules';
import { isTier1, isTier2 } from '../rules/sune';
import { RulesRequest, RulesSignals } from '../rules/types';
import { V2SearchQueryDto } from './dto/v2-search-query.dto';
import {
  V2ClarificationDto,
  V2SearchResponseDto,
} from './dto/v2-search-response.dto';
import { SearchClassificationClient } from './search-classification.client';
import { toSnakeCaseKeys } from './snake-case';

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

@Injectable()
export class V2SearchService {
  constructor(
    private readonly classifier: SearchClassificationClient,
    private readonly hybridSearch: HybridSearchService,
  ) {}

  async search({
    headers,
    query: dto,
  }: {
    headers: HeadersDto;
    query: V2SearchQueryDto;
  }): Promise<V2SearchResponseDto> {
    // Only a string with text classifies. A string array or an AND/OR object
    // is a v1 query shape and has no text for the model.
    const text = typeof dto.query === 'string' ? dto.query : '';
    const hasText = text.trim().length > 0;

    // Classify never throws; a failure comes back as error signals.
    const classified = hasText
      ? await this.classifier.classify(text, headers['x-tenant-id'])
      : null;
    const signals = classified?.signals ?? NO_TEXT_SIGNALS;
    const scores = classified?.scores ?? {};

    const callerNeeds = dto.needs ?? [];
    const rulesRequest: RulesRequest = {
      hasText,
      needs: callerNeeds,
      passedNeeds: dto.passed_needs ?? [],
      urgency: dto.urgency,
      clarify: dto.clarify ?? 'auto',
    };
    const decision = decide(rulesRequest, signals, {}); // tenant context: later slice

    const needScores: NeedScore[] = [];
    for (const code of decision.boostNeeds) {
      const tier = isTier1(code) ? 'tier1' : isTier2(code) ? 'tier2' : null;
      if (!tier) continue;
      const score = callerNeeds.includes(code) ? 1 : scores[code];
      if (typeof score !== 'number') continue;
      needScores.push({ code, tier, score });
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { needs, passed_needs, urgency, clarify, ...v1Fields } = dto;
    const response = await this.hybridSearch.searchHybrid({
      headers,
      query: { ...v1Fields, query_type: 'hybrid' } as SearchResourcesQueryDto,
      rankingVersion: 'v2',
      needScores,
    });

    // byCode and strongTextMatch are placeholders in this slice: the stored
    // need tags (dagster PR #780) and a retrieval signal are not available yet.
    const clarification = finalize(decision, {
      counts: { total: hitsTotal(response), byCode: {} },
      strongTextMatch: false,
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
      clarification: toSnakeCaseKeys<V2ClarificationDto>(clarification),
      emergency: {
        band: decision.emergency.band,
        show_hotline: decision.emergency.showHotline,
      },
      model_version: classified?.modelVersion ?? null,
      rules_version: decision.rulesVersion,
    };
  }
}
