import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureHttp } from '../common/http/configure-http';
import { InternalApiGuard } from '../common/guards/internal-api.guard';
import { CrawlerTrafficInternalController } from './crawler-traffic-internal.controller';
import { CrawlerTrafficService } from './services/crawler-traffic.service';

/**
 * Norse posts to the legacy `/internal/crawler-traffic`. A controller declared
 * `version: '1'` answers only at `/v1/...`, so the legacy path was a 404.
 */
describe('crawler traffic ingest paths', () => {
  const record = jest.fn().mockResolvedValue(1);
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CrawlerTrafficInternalController],
      providers: [{ provide: CrawlerTrafficService, useValue: { record } }],
    })
      .overrideGuard(InternalApiGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    // What main.ts calls, so the test routes the way production does.
    configureHttp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => record.mockClear());

  it.each(['/internal/crawler-traffic', '/v1/internal/crawler-traffic'])(
    'POST %s reaches the route',
    async (path) => {
      const res = await request(app.getHttpServer())
        .post(path)
        .send({ buckets: [] });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ recorded: 1 });
      expect(record).toHaveBeenCalledTimes(1);
    },
  );
});
