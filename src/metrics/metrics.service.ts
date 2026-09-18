import os from 'node:os';
import {
  HttpException,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
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

@Injectable()
export class MetricsService implements OnModuleDestroy {
  private readonly logger = new Logger(MetricsService.name);
  private readonly pushFailuresCounter: Counter;
  private readonly lastPushSuccessGauge: Gauge;
  private httpRequestsCounter: Counter<string> | null = null;
  private httpDurationHistogram: Histogram<string> | null = null;
  private downstreamRequestsCounter: Counter<string> | null = null;
  private downstreamDurationHistogram: Histogram<string> | null = null;
  private cacheRequestsCounter: Counter<string> | null = null;
  private readonly gateway: Pushgateway<PrometheusContentType> | null;
  private readonly pushIntervalMs: number;
  private readonly instanceId = `${os.hostname()}:${process.pid}`;
  private pushInterval: NodeJS.Timeout | null = null;

  constructor(private readonly configService: ConfigService) {
    collectDefaultMetrics({ register });

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

    this.pushIntervalMs = this.configService.get<number>('PUSH_INTERVAL_MS');

    const gatewayUrl = this.configService.get<string>('PUSH_GATEWAY_URL');
    const pushEnabled = this.configService.get<boolean>(
      'PUSH_METRICS_ENABLED',
      true,
    );
    if (gatewayUrl && pushEnabled) {
      const username = this.configService.get<string>('PUSH_GATEWAY_USERNAME');
      const password = this.configService.get<string>('PUSH_GATEWAY_PASSWORD');
      const options =
        username && password ? { auth: `${username}:${password}` } : undefined;
      this.gateway = new Pushgateway(gatewayUrl, options);
      this.startPeriodicPush();
      this.logger.log(
        `Prometheus Pushgateway configured at ${gatewayUrl}, pushing every ${this.pushIntervalMs / 1000}s`,
      );
    } else {
      this.gateway = null;
      this.logger.warn('Pushgateway push is disabled or unconfigured');
    }
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.pushInterval);
    await this.pushMetrics();
  }

  private startPeriodicPush(): void {
    this.pushInterval = setInterval(() => {
      this.pushMetrics().catch(() => {});
    }, this.pushIntervalMs);
  }

  private async pushMetrics(): Promise<void> {
    if (!this.gateway) return;
    try {
      await this.gateway.pushAdd({
        jobName: 'norse_api',
        groupings: { instance: this.instanceId },
      });
      this.lastPushSuccessGauge.set(Date.now() / 1000);
    } catch (err) {
      this.pushFailuresCounter.inc();
      this.logger.error('Pushgateway push failed', err);
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
    this.ensureHttpMetrics();
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
   */
  async observeDownstream<T>(
    dependency: string,
    operation: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    this.ensureDownstreamMetrics();
    const start = performance.now();
    try {
      const result = await fn();
      this.recordDownstream(dependency, operation, 'ok', start);
      return result;
    } catch (err) {
      const outcome =
        err instanceof HttpException
          ? err.getStatus() === 503
            ? 'timeout'
            : 'error'
          : 'error';
      this.recordDownstream(dependency, operation, outcome, start);
      throw err;
    }
  }

  /**
   * Records one cache access outcome.
   */
  recordCacheAccess(
    cache: string,
    result: 'hit' | 'miss' | 'coalesced' | 'get-error',
  ): void {
    this.ensureCacheMetrics();
    this.cacheRequestsCounter.inc({ cache, result });
  }

  private recordDownstream(
    dependency: string,
    operation: string,
    outcome: string,
    start: number,
  ): void {
    this.downstreamRequestsCounter.inc({ dependency, operation, outcome });
    this.downstreamDurationHistogram.observe(
      { dependency },
      (performance.now() - start) / 1000,
    );
  }

  private ensureHttpMetrics(): void {
    if (!this.httpRequestsCounter) {
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
        buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
        registers: [register],
      });
    }
  }

  private ensureDownstreamMetrics(): void {
    if (!this.downstreamRequestsCounter) {
      this.downstreamRequestsCounter = this.createOrGetCounter({
        name: 'norse_downstream_requests_total',
        help: 'Total requests to downstream dependencies',
        labelNames: ['dependency', 'operation', 'outcome'],
        registers: [register],
      });
      this.downstreamDurationHistogram = this.createOrGetHistogram({
        name: 'norse_downstream_duration_seconds',
        help: 'Downstream request duration in seconds',
        labelNames: ['dependency'],
        buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
        registers: [register],
      });
    }
  }

  private ensureCacheMetrics(): void {
    if (!this.cacheRequestsCounter) {
      this.cacheRequestsCounter = this.createOrGetCounter({
        name: 'norse_cache_requests_total',
        help: 'Total cache accesses by result',
        labelNames: ['cache', 'result'],
        registers: [register],
      });
    }
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
