import os from 'node:os';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Counter,
  Gauge,
  Histogram,
  PrometheusContentType,
  Pushgateway,
  collectDefaultMetrics,
  register,
} from 'prom-client';

const DURATION_BUCKETS_SECONDS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

export type DownstreamOutcome = 'ok' | 'timeout' | 'error';

const PUSH_JOB_NAME = 'norse_api';

const PUSH_REQUEST_TIMEOUT_MS = 5_000;

@Injectable()
export class MetricsService implements OnModuleDestroy {
  private readonly logger = new Logger(MetricsService.name);
  private readonly pushFailuresCounter: Counter | null;
  private readonly lastPushSuccessGauge: Gauge | null;
  private readonly httpRequestsCounter: Counter<string>;
  private readonly httpDurationHistogram: Histogram<string>;
  private readonly downstreamRequestsCounter: Counter<string>;
  private readonly downstreamDurationHistogram: Histogram<string>;
  private readonly cacheRequestsCounter: Counter;
  private readonly gateway: Pushgateway<PrometheusContentType> | null;
  private readonly pushIntervalMs: number;
  private readonly instanceId = `${os.hostname()}:${process.pid}`;
  private pushInterval: NodeJS.Timeout | null = null;
  private inflightPush: Promise<void> | null = null;

  constructor(private readonly configService: ConfigService) {
    collectDefaultMetrics({ register });

    const gatewayUrl = this.configService.get<string>('PUSH_GATEWAY_URL');
    const pushEnabled = this.configService.get<boolean>(
      'PUSH_METRICS_ENABLED',
      true,
    );
    // Push is only active when a gateway URL is configured AND pushes are
    // enabled; a scrape-only pod must not register push status metrics.
    const pushActive = Boolean(gatewayUrl) && pushEnabled;
    if (pushActive) {
      this.pushFailuresCounter = this.createOrGetCounter({
        name: 'norse_metrics_push_failures_total',
        help: 'Total failed Pushgateway pushes from this instance',
        labelNames: [],
        registers: [register],
      });

      this.lastPushSuccessGauge = this.createOrGetGauge({
        name: 'norse_metrics_push_success_timestamp_seconds',
        help: 'Unix timestamp of the last successful Pushgateway push',
        labelNames: [],
        registers: [register],
      });
    } else {
      this.pushFailuresCounter = null;
      this.lastPushSuccessGauge = null;
    }

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

    this.pushIntervalMs = this.configService.get<number>('PUSH_INTERVAL_MS');

    if (pushActive) {
      const username = this.configService.get<string>('PUSH_GATEWAY_USERNAME');
      const password = this.configService.get<string>('PUSH_GATEWAY_PASSWORD');
      const options = {
        timeout: PUSH_REQUEST_TIMEOUT_MS,
        ...(username && password ? { auth: `${username}:${password}` } : {}),
      };
      this.gateway = new Pushgateway(gatewayUrl, options);
      this.startPeriodicPush();
      this.logger.log(
        `Prometheus Pushgateway configured at ${gatewayUrl}, pushing every ${this.pushIntervalMs / 1000}s`,
      );
    } else {
      this.gateway = null;
      this.logger.warn('Pushgateway push is disabled or unconfigured');
    }

    const scrapeEnabled = this.configService.get<boolean>(
      'METRICS_ENDPOINT_ENABLED',
      false,
    );
    if (pushActive && scrapeEnabled) {
      this.logger.warn(
        'both push and scrape enabled; series will be double-counted if Prometheus scrapes both',
      );
    }
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

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.pushInterval);
    await this.inflightPush;
    await this.pushMetrics();
    await this.deleteInstanceGroup();
  }

  private startPeriodicPush(): void {
    this.pushInterval = setInterval(() => {
      this.pushMetrics().catch(() => {});
    }, this.pushIntervalMs);
  }

  private pushMetrics(): Promise<void> {
    const p = this.doPush().finally(() => {
      if (this.inflightPush === p) this.inflightPush = null;
    });
    this.inflightPush = p;
    return p;
  }

  private async doPush(): Promise<void> {
    if (!this.gateway) return;
    try {
      await this.gateway.push({
        jobName: PUSH_JOB_NAME,
        groupings: { instance: this.instanceId },
      });
      this.lastPushSuccessGauge?.set(Date.now() / 1000);
    } catch (err) {
      this.pushFailuresCounter?.inc();
      this.logger.error('Pushgateway push failed', err);
    }
  }

  private async deleteInstanceGroup(): Promise<void> {
    if (!this.gateway) return;
    try {
      await this.gateway.delete({
        jobName: PUSH_JOB_NAME,
        groupings: { instance: this.instanceId },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to delete Pushgateway group ${PUSH_JOB_NAME}/instance=${this.instanceId}`,
        err,
      );
    }
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
  recordCacheAccess(
    cache: string,
    result: 'hit' | 'miss' | 'coalesced' | 'get-error',
  ): void {
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

  private createOrGetGauge(
    config: ConstructorParameters<typeof Gauge>[0],
  ): Gauge {
    const existingMetric = register.getSingleMetric(config.name);
    if (existingMetric instanceof Gauge) {
      return existingMetric;
    }
    return new Gauge(config);
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
