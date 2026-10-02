import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HealthController } from 'src/health/health.controller';
import { HealthService } from 'src/health/health.service';

/**
 * Kubernetes probes do not send `x-api-version`, so /health must be
 * VERSION_NEUTRAL to keep responding after main.ts enabled header
 * versioning with defaultVersion: '1'. Mirrors the exact versioning
 * config from src/main.ts; uses a focused module (real HealthController
 * + HealthService) because AppModule can't boot under ts-jest (ESM-only
 * ArcjetModule - see test/support/gateway-test-app.ts).
 */
describe('HealthController versioning (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [HealthService],
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

  it('GET /health without x-api-version header -> 200', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'up' });
  });

  it('GET /health with x-api-version: 1 -> 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/health')
      .set('x-api-version', '1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'up' });
  });
});
