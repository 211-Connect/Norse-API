import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { trace } from '@opentelemetry/api';
import { RequestCacheService } from 'src/common/services/cache/request-cache.service';
import { normalizeQueryText } from '../../search/internal/query-text';
import { classifyCacheKey } from './classify-cache-key';
import { AiClassificationSetting } from '../rules/types';
import { MlBrokerHttpService } from 'src/ml-broker/ml-broker-http.service';
import { MlBrokerError } from 'src/ml-broker/ml-broker.errors';
import { ClassifyResult, toRulesSignals } from './to-rules-signals';

export type { ClassifyResult } from './to-rules-signals';

const failed = (): ClassifyResult => ({
  signals: { needs: { status: 'error' }, emergency: { status: 'error' } },
  scores: {},
  modelVersion: null,
});

// ADR 0039 Decision 40.
// Under 1 h so a cached classification never outlives ADR 0039 Decision 40 (Lucas, 2026-11-18: 59 min).
const CLASSIFY_CACHE_TTL_MS = 59 * 60 * 1000;

/** A result that may be stored: both signals ok and a scores object. */
const isCacheable = (r: unknown): r is ClassifyResult => {
  const x = r as Partial<ClassifyResult> | null | undefined;
  return (
    typeof x === 'object' &&
    x !== null &&
    x.signals?.needs?.status === 'ok' &&
    x.signals?.emergency?.status === 'ok' &&
    typeof x.scores === 'object' &&
    x.scores !== null
  );
};

/** Thrown inside the cache factory so an error result is never stored. */
class UncacheableResult extends Error {
  constructor(readonly result: ClassifyResult) {
    super('uncacheable classify result');
  }
}

/**
 * `/v2/search`'s failure policy over ml-broker `search-classification`. It
 * never throws: every failure becomes `status: 'error'` signals, so search
 * results still return. Transport lives in MlBrokerHttpService. Warnings never
 * carry the query text, which can hold personal data.
 *
 * Cache: a result with both signals ok is stored in Redis (RequestCacheService)
 * for 59 min under `classify:v1:{tenant}:{ai}:{sha256 of normalized text}`; see
 * classify-cache-key.ts. Error results are never stored. Off only when
 * CLASSIFY_CACHE_ENABLED is exactly `false`. The hit flag goes on the active
 * span as `v2.classify.cache_hit`.
 */
@Injectable()
export class SearchClassificationClient {
  private readonly logger = new Logger(SearchClassificationClient.name);

  constructor(
    private readonly mlBroker: MlBrokerHttpService,
    private readonly config: ConfigService,
    private readonly requestCache: RequestCacheService,
  ) {}

  /**
   * Always calls ml-broker (Lucas 2026-11-13). With AI classification off and
   * ML_BROKER_EMERGENCY_ONLY_SUPPORTED exactly `true`, the request carries
   * `emergency_only: true` so ml-broker skips the needs model. An older
   * ml-broker may reject the unknown field, hence the flag (default off).
   */
  async classify(
    query: string,
    tenantId: string,
    aiClassification: AiClassificationSetting = 'on',
  ): Promise<ClassifyResult> {
    const text = normalizeQueryText(query);
    const emergencyOnly =
      aiClassification === 'off' &&
      this.config.get('ML_BROKER_EMERGENCY_ONLY_SUPPORTED') === 'true';
    const callBroker = async (): Promise<ClassifyResult> =>
      toRulesSignals(
        await this.mlBroker.classifySearch({
          query: text,
          tenant_id: tenantId,
          ...(emergencyOnly && { emergency_only: true }),
        }),
      );
    const setHit = (hit: boolean) =>
      trace.getActiveSpan()?.setAttribute('v2.classify.cache_hit', hit);
    const cacheEnabled = this.config.get('CLASSIFY_CACHE_ENABLED') !== 'false';
    const key = classifyCacheKey(tenantId, aiClassification, text);
    let called = false;
    try {
      if (!cacheEnabled) {
        setHit(false);
        return await callBroker();
      }
      const result = await this.requestCache.getOrSet<ClassifyResult>(
        key,
        async () => {
          called = true;
          const fresh = await callBroker();
          // Never store an error signal: a missed emergency must not be reused.
          if (!isCacheable(fresh)) throw new UncacheableResult(fresh);
          return fresh;
        },
        CLASSIFY_CACHE_TTL_MS,
      );
      if (isCacheable(result)) {
        setHit(!called);
        return result;
      }
      // A stored value with the wrong shape counts as a miss: call again and
      // overwrite it when the fresh result is storable.
      setHit(false);
      const fresh = await callBroker();
      if (isCacheable(fresh)) {
        await this.requestCache.setMany(
          { [key]: fresh },
          CLASSIFY_CACHE_TTL_MS,
        );
      }
      return fresh;
    } catch (error) {
      if (error instanceof UncacheableResult) {
        setHit(false);
        return error.result;
      }
      // MlBrokerError messages hold no request or response body.
      const reason =
        error instanceof MlBrokerError
          ? `kind=${error.kind}: ${error.message}`
          : `kind=unexpected: ${error instanceof Error ? error.name : 'Error'}`;
      this.logger.warn(`search classification failed, ${reason}`);
      setHit(false);
      return failed();
    }
  }
}
