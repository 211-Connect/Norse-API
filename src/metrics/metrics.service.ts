import { Injectable } from '@nestjs/common';
import {
  Counter,
  Histogram,
  collectDefaultMetrics,
  register,
} from '@prometheus-io/client';

const DURATION_BUCKETS_SECONDS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

export type DownstreamOutcome = 'ok' | 'timeout' | 'error';

export type CacheName =
  | 'request-redis' // RequestCacheService (Redis)
  | 'analytics-lru' // AnalyticsCacheService L1, in-process LRU
  | 'analytics-redis' // AnalyticsCacheService L2, app Redis
  | 'tenant-config-lru' // TenantConfigService in-process LRUs
  | 'tenant-config-redis' // TenantConfigService CMS Redis (DB 2, written by PayloadCMS)
  | 'tenant-config-app-redis'; // TenantConfigService app-Redis fallback (Keycloak realm id only)

export type CacheResult = 'hit' | 'miss' | 'coalesced' | 'get-error';

@Injectable()
export class MetricsService {
  private readonly httpRequestsCounter: Counter<string>;
  private readonly httpDurationHistogram: Histogram<string>;
  private readonly downstreamRequestsCounter: Counter<string>;
  private readonly downstreamDurationHistogram: Histogram<string>;
  private readonly cacheRequestsCounter: Counter<string>;

  constructor() {
    collectDefaultMetrics({ register });

    this.httpRequestsCounter = this.createOrGetCounter({
      name: 'norse_http_requests_total',
      help: 'Total HTTP requests handled by this instance',
      labelNames: ['method', 'handler', 'status', 'tenant_id', 'domain'],
      registers: [register],
    });

    this.httpDurationHistogram = this.createOrGetHistogram({
      name: 'norse_http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'handler'],
      buckets: DURATION_BUCKETS_SECONDS,
      registers: [register],
    });

    this.downstreamRequestsCounter = this.createOrGetCounter({
      name: 'norse_downstream_requests_total',
      help: 'Total requests to downstream dependencies',
      labelNames: ['dependency', 'operation', 'outcome'],
      registers: [register],
    });

    this.downstreamDurationHistogram = this.createOrGetHistogram({
      name: 'norse_downstream_duration_seconds',
      help: 'Downstream request duration in seconds',
      labelNames: ['dependency', 'operation'],
      buckets: DURATION_BUCKETS_SECONDS,
      registers: [register],
    });

    this.cacheRequestsCounter = this.createOrGetCounter({
      name: 'norse_cache_requests_total',
      help: 'Total cache accesses by result',
      labelNames: ['cache', 'result'],
      registers: [register],
    });
  }

  /**
   * Exposes the Prometheus text exposition of the global register.
   * Used by MetricsController for GET /metrics (scrape mode).
   */
  getMetrics(): Promise<string> {
    return register.metrics();
  }

  getContentType(): string {
    return register.contentType;
  }

  /**
   * Records one handled HTTP request (called by MetricsInterceptor).
   */
  recordHttpRequest(
    method: string,
    handler: string,
    domain: string,
    status: string,
    tenantId: string,
    durationSeconds: number,
  ): void {
    this.httpRequestsCounter.inc({
      method,
      handler,
      status,
      tenant_id: tenantId,
      domain,
    });
    this.httpDurationHistogram.observe({ method, handler }, durationSeconds);
  }

  /**
   * Observes one downstream dependency call. Rethrows the original error.
   * The optional classifier maps a successful result to 'ok' or 'error'
   * (e.g. HTTP responses that resolve with a non-2xx status).
   */
  async observeDownstream<T>(
    dependency: string,
    operation: string,
    fn: () => Promise<T>,
    classifyResult?: (result: T) => DownstreamOutcome,
  ): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      const outcome: DownstreamOutcome = classifyResult
        ? classifyResult(result)
        : 'ok';
      this.recordDownstream(dependency, operation, outcome, start);
      return result;
    } catch (err) {
      this.recordDownstream(
        dependency,
        operation,
        this.downstreamOutcomeFromError(err),
        start,
      );
      throw err;
    }
  }

  private downstreamOutcomeFromError(err: unknown): DownstreamOutcome {
    if (typeof err !== 'object' || err === null || !('name' in err)) {
      return 'error';
    }
    const { name } = err;
    return name === 'TimeoutError' || name === 'AbortError'
      ? 'timeout'
      : 'error';
  }

  /**
   * Records one cache access outcome.
   */
  recordCacheAccess(cache: CacheName, result: CacheResult): void {
    this.cacheRequestsCounter.inc({ cache, result });
  }

  private recordDownstream(
    dependency: string,
    operation: string,
    outcome: DownstreamOutcome,
    start: number,
  ): void {
    this.downstreamRequestsCounter.inc({ dependency, operation, outcome });
    this.downstreamDurationHistogram.observe(
      { dependency, operation },
      (performance.now() - start) / 1000,
    );
  }

  private createOrGetCounter(
    config: ConstructorParameters<typeof Counter>[0],
  ): Counter {
    const existingMetric = register.getSingleMetric(config.name);
    if (existingMetric instanceof Counter) {
      return existingMetric;
    }
    return new Counter(config);
  }

  private createOrGetHistogram(
    config: ConstructorParameters<typeof Histogram>[0],
  ): Histogram<string> {
    const existingMetric = register.getSingleMetric(config.name);
    if (existingMetric instanceof Histogram) {
      return existingMetric;
    }
    return new Histogram(config);
  }
}
