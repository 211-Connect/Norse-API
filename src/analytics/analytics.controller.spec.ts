import { INestApplication } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AnalyticsController } from './analytics.controller';
import { AnalyticsApiKeyGuard } from './guards/analytics-api-key.guard';
import { AnalyticsConfigService } from './services/analytics-config.service';
import { AnalyticsInfoEnricherService } from './services/analytics-info-enricher.service';
import { UmamiAnalyticsService } from './services/umami-analytics.service';
import { CdnCacheControlInterceptor } from '../common/interceptors/cdn-cache-control.interceptor';

/**
 * Analytics responses are per-tenant (selected by request headers, never by
 * URL) and gated by an API-key guard. Shared caches key on the URL and
 * ignore Vary, so any cacheable analytics response leaks the cached tenant
 * body to every client hitting the same URL. These specs pin the contract
 * that keeps analytics responses uncacheable, with the app-wide
 * CdnCacheControlInterceptor present to prove it cannot re-enable shared
 * caching on these routes.
 */
describe('AnalyticsController response caching', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [
        // Registered app-wide in AppModule via APP_INTERCEPTOR.
        { provide: APP_INTERCEPTOR, useClass: CdnCacheControlInterceptor },
        {
          provide: UmamiAnalyticsService,
          useValue: {
            getStats: jest.fn().mockResolvedValue({}),
            getHeatmap: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: AnalyticsConfigService,
          useValue: {
            getWebsiteIds: jest.fn().mockResolvedValue(['site-1']),
          },
        },
        { provide: AnalyticsInfoEnricherService, useValue: {} },
      ],
    })
      .overrideGuard(AnalyticsApiKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves dated analytics responses with Cache-Control: no-store', async () => {
    const res = await request(app.getHttpServer())
      .get('/analytics/stats')
      .query({ start: '2026-09-01', end: '2026-09-30' });

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('keeps no-store on heatmap, which previously opted into CDN caching', async () => {
    const res = await request(app.getHttpServer())
      .get('/analytics/heatmap')
      .query({ start: '2026-09-01', end: '2026-09-30' });

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
