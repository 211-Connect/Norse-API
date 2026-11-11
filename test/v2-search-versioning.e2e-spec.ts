// `@arcjet/nest` ships ESM only; the guard decorator only needs the token.
jest.mock('@arcjet/nest', () => ({ ARCJET: 'ARCJET' }));

import {
  Controller,
  Get,
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
  Version,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HttpExceptionFilter } from 'src/common/filters/global-exception.filter';
import {
  ApiVersionMiddleware,
  API_VERSION_MIDDLEWARE_ROUTES,
} from 'src/common/middleware/ApiVersionMiddleware';
import { configureHttp } from 'src/common/http/configure-http';
import { UsageMetricsService } from 'src/metrics/usage-metrics.service';
import { V2SearchController } from 'src/v2/search/v2-search.controller';
import { V2SearchEnabledGuard } from 'src/v2/search/v2-search-enabled.guard';
import { V2SearchService } from 'src/v2/search/v2-search.service';

/** Stands in for the v1 SearchController, which has the same path. */
@Controller('search')
class V1SearchStubController {
  @Get()
  @Version('1')
  get() {
    return { route: 'v1' };
  }
}

const TENANT = '11111111-1111-4111-8111-111111111111';

/**
 * The real V2SearchController (its real decorators and guards) behind a fake
 * V2SearchService, next to a v1 stub on the same path, under the real
 * configureHttp and ApiVersionMiddleware. AppModule cannot boot under ts-jest
 * (ESM-only ArcjetModule, see test/support/gateway-test-app.ts).
 */
describe('v2 search versioning (e2e)', () => {
  let app: INestApplication;
  const searchMock = jest.fn();

  async function boot(flag: string | undefined) {
    @Module({
      controllers: [V1SearchStubController, V2SearchController],
      providers: [
        V2SearchEnabledGuard,
        { provide: V2SearchService, useValue: { search: searchMock } },
        {
          provide: UsageMetricsService,
          useValue: { recordSearchRequest: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) => (k === 'V2_SEARCH_ENABLED' ? flag : undefined),
          },
        },
      ],
    })
    class TestModule implements NestModule {
      configure(consumer: MiddlewareConsumer) {
        consumer
          .apply(ApiVersionMiddleware)
          .forRoutes(API_VERSION_MIDDLEWARE_ROUTES);
      }
    }
    const moduleRef = await Test.createTestingModule({
      imports: [TestModule],
    }).compile();
    const nestApp = moduleRef.createNestApplication();
    nestApp.useGlobalFilters(new HttpExceptionFilter());
    configureHttp(nestApp);
    await nestApp.init();
    return nestApp;
  }

  const get = (path: string, version?: string) => {
    const req = request(app.getHttpServer())
      .get(path)
      .set('x-tenant-id', TENANT)
      .set('accept-language', 'en');
    if (version !== undefined) req.set('x-api-version', version);
    return req;
  };

  beforeEach(() => {
    searchMock.mockReset();
    searchMock.mockResolvedValue({
      route: 'v2',
      search: { hits: { total: 0 } },
    });
  });
  afterEach(async () => {
    await app?.close();
  });

  describe('flag on', () => {
    beforeEach(async () => {
      app = await boot('true');
    });

    it('/v2/search without a header reaches the v2 route', async () => {
      const res = await get('/v2/search?query=rent');
      expect(res.status).toBe(200);
      expect(res.body.route).toBe('v2');
      expect(searchMock).toHaveBeenCalledTimes(1);
    });

    it('/search with x-api-version: 2 reaches the v2 route', async () => {
      const res = await get('/search?query=rent', '2');
      expect(res.status).toBe(200);
      expect(res.body.route).toBe('v2');
    });

    it('/search without a header still reaches the v1 route', async () => {
      const res = await get('/search');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ route: 'v1' });
      expect(searchMock).not.toHaveBeenCalled();
    });

    it('/search with x-api-version: 1 reaches the v1 route', async () => {
      const res = await get('/search', '1');
      expect(res.body).toEqual({ route: 'v1' });
    });

    it('x-api-version: 3 is a 400 that names the header', async () => {
      const res = await get('/search', '3');
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('x-api-version');
    });

    it('validates the v2 query (bad urgency is a 400)', async () => {
      const res = await get('/v2/search?urgency=U-9');
      expect(res.status).toBe(400);
      expect(searchMock).not.toHaveBeenCalled();
    });
  });

  describe('flag off', () => {
    it.each([undefined, '', 'false', 'TRUE'])(
      '/v2/search is a 404 when V2_SEARCH_ENABLED is %p, even for a bad query',
      async (flag) => {
        app = await boot(flag);
        const res = await get('/v2/search?urgency=U-9');
        expect(res.status).toBe(404);
        expect(searchMock).not.toHaveBeenCalled();
      },
    );
  });
});
