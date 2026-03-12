import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Counter,
  Pushgateway,
  collectDefaultMetrics,
  register,
} from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleDestroy {
  private readonly logger = new Logger(MetricsService.name);
  private readonly searchHitsCounter: Counter<string>;
  private readonly resourceHitsCounter: Counter<string>;
  private readonly gateway: Pushgateway<'text/plain; version=0.0.4; charset=utf-8'> | null;
  private readonly pushIntervalMs: number;
  private pushInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly configService: ConfigService) {
    collectDefaultMetrics({ register });

    this.searchHitsCounter = this.createOrGetCounter(
      'norse_search_hits_total',
      {
        help: 'Total hits for /search endpoints',
        labelNames: ['method', 'handler'],
        registers: [register],
      },
    );

    this.resourceHitsCounter = this.createOrGetCounter(
      'norse_resource_hits_total',
      {
        help: 'Total hits for /resource endpoints',
        labelNames: ['method', 'handler'],
        registers: [register],
      },
    );

    this.pushIntervalMs = this.configService.get<number>('pushIntervalMs');

    const gatewayUrl = this.configService.get<string>('pushgatewayUrl');
    if (gatewayUrl) {
      this.gateway = new Pushgateway(gatewayUrl);
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

  incrementSearchHit(method: string, handler: string): void {
    this.searchHitsCounter.inc({ method, handler });
  }

  incrementResourceHit(method: string, handler: string): void {
    this.resourceHitsCounter.inc({ method, handler });
  }

  private startPeriodicPush(): void {
    this.pushInterval = setInterval(() => {
      this.pushMetrics().catch((err) =>
        this.logger.error('Failed to push metrics', err),
      );
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
    name: string,
    options: Omit<ConstructorParameters<typeof Counter>[0], 'name'>,
  ): Counter<string> {
    const existingMetric = register.getSingleMetric(
      name,
    ) as Counter<string> | null;

    if (existingMetric) {
      return existingMetric;
    }

    return new Counter({
      name,
      ...options,
    });
  }
}
