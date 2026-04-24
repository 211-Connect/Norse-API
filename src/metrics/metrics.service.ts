import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Counter,
  PrometheusContentType,
  Pushgateway,
  collectDefaultMetrics,
  register,
} from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleDestroy {
  private readonly logger = new Logger(MetricsService.name);
  private readonly searchHitsCounter: Counter;
  private readonly resourceHitsCounter: Counter;
  private readonly gateway: Pushgateway<PrometheusContentType> | null;
  private readonly pushIntervalMs: number;
  private pushInterval: NodeJS.Timeout | null = null;

  constructor(private readonly configService: ConfigService) {
    collectDefaultMetrics({ register });

    this.searchHitsCounter = this.createOrGetCounter({
      name: 'norse_search_hits_total',
      help: 'Total hits for /search endpoints',
      labelNames: ['method', 'handler', 'tenant_id'],
      registers: [register],
    });

    this.resourceHitsCounter = this.createOrGetCounter({
      name: 'norse_resource_hits_total',
      help: 'Total hits for /resource endpoints',
      labelNames: ['method', 'handler', 'tenant_id'],
      registers: [register],
    });

    this.pushIntervalMs = this.configService.get<number>('PUSH_INTERVAL_MS');

    const gatewayUrl = this.configService.get<string>('PUSH_GATEWAY_URL');
    if (gatewayUrl) {
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
      this.logger.warn(
        'PROMETHEUS_PUSHGATEWAY_URL not set — metrics will not be pushed',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pushInterval) {
      clearInterval(this.pushInterval);
    }
    await this.pushMetrics();
  }

  incrementSearchHit(method: string, handler: string, tenantId: string): void {
    this.searchHitsCounter.inc({ method, handler, tenant_id: tenantId });
  }

  incrementResourceHit(method: string, handler: string, tenantId: string): void {
    this.resourceHitsCounter.inc({ method, handler, tenant_id: tenantId });
  }

  private startPeriodicPush(): void {
    this.pushInterval = setInterval(() => {
      this.pushMetrics().catch(() => {});
    }, this.pushIntervalMs);
  }

  private async pushMetrics(): Promise<void> {
    if (!this.gateway) return;
    try {
      await this.gateway.pushAdd({ jobName: 'norse_api' });
    } catch (err) {
      this.logger.error('Pushgateway push failed', err);
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
}
