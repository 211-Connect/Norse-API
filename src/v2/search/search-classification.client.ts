import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from 'src/metrics/metrics.service';
import {
  EmergencySignal,
  ModelUrgencyLevel,
  RulesSignals,
} from '../rules/types';

const DEFAULT_TIMEOUT_MS = 1000;
const URGENCY_LEVELS: readonly string[] = ['U-1', 'U-2', 'U-3', 'U-4'];

export interface ClassifyResult {
  signals: RulesSignals;
  scores: Record<string, number>;
  modelVersion: string | null;
}

type BrokerEmergency = {
  status: 'ok' | 'error';
  score: number | null;
  floor_hit: boolean | null;
  calm_context: boolean | null;
  dv_shelter: boolean | null;
};

type BrokerResponse = {
  model_version?: string;
  needs: { scores: { code: string; tier: string; score: number }[] };
  urgency: { level: string; score: number };
  emergency?: BrokerEmergency;
};

const failed = (): ClassifyResult => ({
  signals: { needs: { status: 'error' }, emergency: { status: 'error' } },
  scores: {},
  modelVersion: null,
});

const orUndefined = <T>(value: T | null | undefined): T | undefined =>
  value ?? undefined;

/**
 * Calls ml-broker `search-classification` for `/v2/search`. It never throws:
 * every failure becomes `status: 'error'` signals, so search results still
 * return. Warnings never carry the query text, which can hold personal data.
 */
@Injectable()
export class SearchClassificationClient {
  private readonly logger = new Logger(SearchClassificationClient.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  async classify(query: string, tenantId: string): Promise<ClassifyResult> {
    const baseUrl = this.configService.get<string>('ML_BROKER_BASE_URL');
    const apiKey = this.configService.get<string>('ML_BROKER_API_KEY');
    if (!baseUrl || !apiKey) {
      this.logger.warn('search classification is not configured');
      return failed();
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      const response = await this.metrics.observeDownstream(
        'ml_broker',
        'search_classification',
        () =>
          fetch(`${baseUrl}/api/v1/tasks/search-classification/predict`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
            },
            body: JSON.stringify({ query, tenant_id: tenantId }),
            signal: controller.signal,
          }),
        (res) => (res.ok ? 'ok' : 'error'),
      );
      if (!response.ok) {
        this.logger.warn(
          `search classification failed: status=${response.status}`,
        );
        return failed();
      }
      return this.toResult((await response.json()) as BrokerResponse);
    } catch (error) {
      const reason =
        error?.name === 'AbortError'
          ? `timed out after ${this.timeoutMs()}ms`
          : `request failed: ${error?.name ?? 'Error'}`;
      this.logger.warn(`search classification ${reason}`);
      return failed();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private timeoutMs(): number {
    const raw = Number.parseInt(
      String(this.configService.get('V2_CLASSIFY_TIMEOUT_MS') ?? ''),
      10,
    );
    return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
  }

  /** Throws on a body that is not the documented shape; `classify` catches. */
  private toResult(body: BrokerResponse): ClassifyResult {
    if (
      !body ||
      !Array.isArray(body.needs?.scores) ||
      !URGENCY_LEVELS.includes(body.urgency?.level) ||
      typeof body.urgency?.score !== 'number'
    ) {
      throw new TypeError('unexpected search-classification body');
    }
    const scores: Record<string, number> = {};
    for (const entry of body.needs.scores) scores[entry.code] = entry.score;

    const e = body.emergency;
    const emergency: EmergencySignal =
      e && (e.status === 'ok' || e.status === 'error')
        ? {
            status: e.status,
            score: orUndefined(e.score),
            floorHit: orUndefined(e.floor_hit),
            calmContext: orUndefined(e.calm_context),
            dvShelter: orUndefined(e.dv_shelter),
          }
        : { status: 'error' };

    return {
      signals: {
        needs: {
          status: 'ok',
          scores,
          urgency: {
            level: body.urgency.level as ModelUrgencyLevel,
            score: body.urgency.score,
          },
        },
        emergency,
      },
      scores,
      modelVersion:
        typeof body.model_version === 'string' ? body.model_version : null,
    };
  }
}
