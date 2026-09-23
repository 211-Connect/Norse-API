import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MetricsController } from 'src/metrics/metrics.controller';
import { MetricsService } from 'src/metrics/metrics.service';

/**
 * Prometheus does not send `x-api-version`, so /metrics must be
 * VERSION_NEUTRAL to keep responding after main.ts enabled header
 * versioning with defaultVersion: '1'. Mirrors the exact versioning
 * config from src/main.ts; uses a focused module (real MetricsController
 * + MetricsService) because AppModule can't boot under ts-jest (ESM-only
 * ArcjetModule - see test/support/gateway-test-app.ts).
 */
describe('MetricsController versioning (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const configServiceMock = {
      get: jest.fn((key: string) =>
        key === 'METRICS_ENDPOINT_ENABLED'
          ? true
          : key === 'PUSH_METRICS_ENABLED'
            ? false
            : undefined,
      ),
    };

    const moduleFixture = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [
        {
          provide: MetricsService,
          useValue: new MetricsService(configServiceMock as never),
        },
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.enableVersioning({
      type: VersioningType.HEADER,
      header: 'x-api-version',
      defaultVersion: '1',
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /metrics without x-api-version header -> 200 with prometheus text', async () => {
    const res = await request(app.getHttpServer()).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('# TYPE norse_http_requests_total counter');
    expect(res.text).toContain('process_cpu_seconds_total');
    // Push self-observability metrics must be absent in scrape mode.
    expect(res.text).not.toContain(
      'norse_metrics_push_success_timestamp_seconds',
    );
  });

  it('GET /metrics with x-api-version: 1 -> 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/metrics')
      .set('x-api-version', '1');
    expect(res.status).toBe(200);
  });
});
