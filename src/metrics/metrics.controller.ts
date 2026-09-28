import { Controller, Get, Logger, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';
import { Public } from 'src/auth/gateway/gateway-principal';
import { SkipMetrics } from './skip-metrics.decorator';
import { MetricsService } from './metrics.service';

/**
 * Scrape endpoint for Prometheus (Kubernetes). Disabled unless
 * METRICS_ENDPOINT_ENABLED is on, so it stays inert on DigitalOcean
 * App Platform. VERSION_NEUTRAL because Prometheus does not send
 * x-api-version.
 */
@ApiExcludeController()
@Controller({ path: 'metrics', version: VERSION_NEUTRAL })
@Public()
@SkipMetrics()
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);

  private readonly endpointEnabled: boolean;
  private readonly token: string;

  constructor(
    private readonly metricsService: MetricsService,
    configService: ConfigService,
  ) {
    this.endpointEnabled = configService.get<boolean>(
      'METRICS_ENDPOINT_ENABLED',
      false,
    );
    this.token = configService.get<string>('METRICS_TOKEN', '');
  }

  @Get()
  async getMetrics(@Res() res: Response): Promise<void> {
    if (!this.endpointEnabled) {
      res.status(404).send();
      return;
    }

    if (this.token) {
      const header = res.req?.headers?.authorization;
      const provided = typeof header === 'string' ? header : '';
      if (!this.tokenMatches(provided)) {
        res.status(401).send();
        return;
      }
    }

    try {
      const body = await this.metricsService.getMetrics();
      res
        .set({
          'Content-Type': this.metricsService.getContentType(),
          'Cache-Control': 'no-store',
        })
        .status(200)
        .send(body);
    } catch (err) {
      this.logger.error('Failed to render Prometheus metrics', err);
      res.status(500).send();
    }
  }

  private tokenMatches(providedHeader: string): boolean {
    const expected = `Bearer ${this.token}`;
    const a = Buffer.from(providedHeader);
    const b = Buffer.from(expected);
    // timingSafeEqual throws on unequal lengths; length check must come first.
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
