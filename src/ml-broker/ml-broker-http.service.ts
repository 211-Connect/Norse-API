import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from 'src/metrics/metrics.service';
import { MlBrokerError } from './ml-broker.errors';

const DEFAULT_TIMEOUT_MS = 1000;
const SEARCH_CLASSIFICATION = 'search-classification';
const URGENCY_LEVELS: readonly string[] = ['U-1', 'U-2', 'U-3', 'U-4'];

export interface SearchClassificationRequest {
  query: string;
  tenant_id: string;
}

/** ml-broker `search-classification` response, as sent on the wire. */
export interface SearchClassificationResponse {
  model_version?: string;
  needs: { scores: { code: string; tier: string; score: number }[] };
  urgency: { level: 'U-1' | 'U-2' | 'U-3' | 'U-4'; score: number };
  emergency?: {
    status: 'ok' | 'error';
    score: number | null;
    floor_hit: boolean | null;
    calm_context: boolean | null;
    dv_shelter: boolean | null;
  };
}

// Read `name` rather than test `instanceof Error`: the DOMException that
// AbortSignal.timeout rejects with is not always an Error of this realm
// (it is not under Jest), the same reason MetricsService reads `name`.
const errorName = (error: unknown): string => {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === 'string' ? name : 'Error';
};

const isTimeout = (error: unknown) =>
  errorName(error) === 'TimeoutError' || errorName(error) === 'AbortError';

/**
 * Transport for ml-broker: one method per task. It reads its config on every
 * call, so a missing ml-broker config never stops the app from booting, and it
 * throws `MlBrokerError` on every failure. Whether a failure is fatal is the
 * caller's decision. It never logs and never puts a request or response body
 * into an error.
 */
@Injectable()
export class MlBrokerHttpService {
  constructor(
    private readonly configService: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  async classifySearch(
    request: SearchClassificationRequest,
  ): Promise<SearchClassificationResponse> {
    const task = SEARCH_CLASSIFICATION;
    const baseUrl = this.configService.get<string>('ML_BROKER_BASE_URL');
    const apiKey = this.configService.get<string>('ML_BROKER_API_KEY');
    if (!baseUrl || !apiKey) {
      throw new MlBrokerError('unconfigured', task, 'not configured');
    }

    const timeoutMs = this.timeoutMs();
    // One signal for the request and the body read, as before.
    const signal = AbortSignal.timeout(timeoutMs);
    const fail = (error: unknown): never => {
      if (isTimeout(error)) {
        throw new MlBrokerError(
          'timeout',
          task,
          `timed out after ${timeoutMs}ms`,
        );
      }
      throw new MlBrokerError(
        'network',
        task,
        `request failed: ${errorName(error)}`,
      );
    };

    let response: Response;
    try {
      response = await this.metrics.observeDownstream(
        'ml_broker',
        'search_classification',
        () =>
          fetch(`${baseUrl}/api/v1/tasks/${task}/predict`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
            },
            body: JSON.stringify({
              query: request.query,
              tenant_id: request.tenant_id,
            }),
            signal,
          }),
        (res) => (res.ok ? 'ok' : 'error'),
      );
    } catch (error) {
      return fail(error);
    }

    if (!response.ok) {
      // The response body is not read: it can echo the query.
      throw new MlBrokerError(
        'http',
        task,
        `status=${response.status}`,
        response.status,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      if (isTimeout(error)) return fail(error);
      throw new MlBrokerError(
        'malformed',
        task,
        `unparsable body: ${errorName(error)}`,
      );
    }
    return this.assertSearchClassificationShape(body);
  }

  private timeoutMs(): number {
    const raw = Number.parseInt(
      String(this.configService.get('V2_CLASSIFY_TIMEOUT_MS') ?? ''),
      10,
    );
    return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
  }

  /**
   * Hand-written body check: the one place a schema (zod) will replace.
   * Checks exactly what the mapping relies on, no more.
   */
  private assertSearchClassificationShape(
    body: unknown,
  ): SearchClassificationResponse {
    const b = body as Partial<SearchClassificationResponse> | null;
    if (
      !b ||
      !Array.isArray(b.needs?.scores) ||
      !URGENCY_LEVELS.includes(b.urgency?.level as string) ||
      typeof b.urgency?.score !== 'number'
    ) {
      throw new MlBrokerError(
        'malformed',
        SEARCH_CLASSIFICATION,
        'unexpected body shape',
      );
    }
    return b as SearchClassificationResponse;
  }
}
