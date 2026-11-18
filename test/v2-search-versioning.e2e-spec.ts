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
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TenantMiddleware } from 'src/common/middleware/TenantMiddleware';
import { LocaleMiddleware } from 'src/common/middleware/LocaleMiddleware';
import { HttpExceptionFilter } from 'src/common/filters/global-exception.filter';
import {
  ApiVersionMiddleware,
  API_VERSION_MIDDLEWARE_ROUTES,
} from 'src/common/middleware/ApiVersionMiddleware';
import { configureHttp } from 'src/common/http/configure-http';
import {
  CdnCacheControlInterceptor,
  markNotStorable,
} from 'src/common/interceptors/cdn-cache-control.interceptor';
import { SetCdnCacheTTL } from 'src/common/decorators/cdn-cache-ttl.decorator';
import { ONE_HOUR } from 'src/common/const/one-hour';
import { UsageMetricsService } from 'src/metrics/usage-metrics.service';
import { V2SearchController } from 'src/v2/search/v2-search.controller';
import { V2SearchEnabledGuard } from 'src/v2/search/v2-search-enabled.guard';
import { V2SearchService } from 'src/v2/search/v2-search.service';

/** Stands in for the v1 SearchController, which has the same path. */
@Controller('search')
class V1SearchStubController {
  @Get()
  @Version('1')
  @SetCdnCacheTTL(ONE_HOUR)
  get() {
    return { route: 'v1' };
  }
}

const TENANT = '11111111-1111-4111-8111-111111111111';
/** The URL copies of the x-tenant-id and accept-language headers. */
const M = `tenant_id=${TENANT}&locale=en`;

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
        { provide: APP_INTERCEPTOR, useClass: CdnCacheControlInterceptor },
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
        // The real header and URL-mirror checks, as in AppModule.
        consumer
          .apply(TenantMiddleware, LocaleMiddleware)
          .forRoutes(V1SearchStubController, V2SearchController);
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

  const post = (path: string, version?: string) => {
    const req = request(app.getHttpServer())
      .post(path)
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
      const res = await get(`/v2/search?query=rent&${M}`);
      expect(res.status).toBe(200);
      expect(res.body.route).toBe('v2');
      expect(searchMock).toHaveBeenCalledTimes(1);
    });

    it('/search with x-api-version: 2 reaches the v2 route', async () => {
      const res = await get(`/search?query=rent&${M}`, '2');
      expect(res.status).toBe(200);
      expect(res.body.route).toBe('v2');
    });

    it('POST /v2/search reaches the v2 route with the body', async () => {
      const geometry = { type: 'Point', coordinates: [1, 2] };
      const res = await post(`/v2/search?query=rent&${M}`).send({ geometry });
      expect(res.status).toBe(200);
      expect(res.body.route).toBe('v2');
      expect(searchMock).toHaveBeenCalledTimes(1);
      expect(searchMock.mock.calls[0][0].body).toEqual({ geometry });
    });

    it('POST /search with x-api-version: 2 reaches the v2 route', async () => {
      const res = await post(`/search?query=rent&${M}`, '2').send({});
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
      const res = await get(`/v2/search?urgency=U-9&${M}`);
      expect(res.status).toBe(400);
      expect(searchMock).not.toHaveBeenCalled();
    });
  });

  // ADR 0039 Decisions 9 and 28: /search answers v1 or v2 by header, so a
  // cache keyed by URL must never hold a v2 body there, and an emergency
  // answer is never stored anywhere.
  describe('cache headers', () => {
    const NO_STORE = 'no-store, no-cache, must-revalidate, private';
    beforeEach(async () => {
      app = await boot('true');
    });

    it('/v2/search stores a band-none answer, with no Vary on the version', async () => {
      const res = await get(`/v2/search?query=rent&${M}`);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toMatch(/^public, /);
      expect(res.headers['vary'] ?? '').not.toMatch(/x-api-version/i);
    });

    it('/v2/search never stores an answer the service marked', async () => {
      searchMock.mockResolvedValue(
        markNotStorable({ route: 'v2', search: { hits: { total: 0 } } }),
      );
      const res = await get(`/v2/search?query=rent&${M}`);
      expect(res.headers['cache-control']).toBe(NO_STORE);
      expect(res.body).toEqual({ route: 'v2', search: { hits: { total: 0 } } });
    });

    it('/search with x-api-version: 2 is never stored', async () => {
      const res = await get(`/search?query=rent&${M}`, '2');
      expect(res.body.route).toBe('v2');
      expect(res.headers['cache-control']).toBe(NO_STORE);
    });

    it('/search for v1 is stored and varies on x-api-version', async () => {
      const res = await get('/search?query=rent');
      expect(res.body.route).toBe('v1');
      expect(res.headers['cache-control']).toMatch(/^public, /);
      expect(res.headers['vary']).toMatch(/x-api-version/i);
    });
  });

  // Lucas 2026-11-18: a URL-keyed CDN ignores Vary, so a v2 search URL must
  // carry the tenant and the language. Missing is a 400, not a private answer.
  describe('v2 needs the tenant_id and locale URL copies', () => {
    beforeEach(async () => {
      app = await boot('true');
    });

    const refused = (res: request.Response, param: string) => {
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain(param);
      expect(searchMock).not.toHaveBeenCalled();
    };

    it('GET /v2/search without tenant_id is a 400 that names it', async () => {
      refused(await get('/v2/search?query=rent&locale=en'), 'tenant_id');
    });

    it('GET /v2/search without locale is a 400 that names it', async () => {
      refused(await get(`/v2/search?query=rent&tenant_id=${TENANT}`), 'locale');
    });

    it('GET /v2/search without either is a 400', async () => {
      const res = await get('/v2/search?query=rent');
      expect(res.status).toBe(400);
      expect(searchMock).not.toHaveBeenCalled();
    });

    it('an empty tenant_id or locale counts as missing', async () => {
      refused(
        await get(`/v2/search?query=rent&tenant_id=&locale=en`),
        'tenant_id',
      );
      refused(
        await get(`/v2/search?query=rent&tenant_id=${TENANT}&locale=`),
        'locale',
      );
    });

    it('POST /v2/search without tenant_id or locale is a 400', async () => {
      refused(
        await post('/v2/search?query=rent&locale=en').send({}),
        'tenant_id',
      );
      refused(
        await post(`/v2/search?query=rent&tenant_id=${TENANT}`).send({}),
        'locale',
      );
    });

    it('/search with x-api-version: 2 needs them too', async () => {
      refused(await get('/search?query=rent', '2'), 'tenant_id');
    });

    it('both present and matching reach the route', async () => {
      const res = await get(`/v2/search?query=rent&${M}`);
      expect(res.status).toBe(200);
      expect(searchMock).toHaveBeenCalledTimes(1);
    });

    it('a tenant_id that differs from x-tenant-id is a 400', async () => {
      const other = '22222222-2222-4222-8222-222222222222';
      const res = await get(
        `/v2/search?query=rent&tenant_id=${other}&locale=en`,
      );
      expect(res.status).toBe(400);
      expect(searchMock).not.toHaveBeenCalled();
    });

    it('a locale that differs from accept-language is a 400', async () => {
      const res = await get(
        `/v2/search?query=rent&tenant_id=${TENANT}&locale=es`,
      );
      expect(res.status).toBe(400);
      expect(searchMock).not.toHaveBeenCalled();
    });

    it('v1 /search is unchanged: no copies needed', async () => {
      const res = await get('/search?query=rent');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ route: 'v1' });
    });
  });

  describe('flag off', () => {
    it.each([undefined, '', 'false', 'TRUE'])(
      '/v2/search is a 404 when V2_SEARCH_ENABLED is %p, even for a bad query',
      async (flag) => {
        app = await boot(flag);
        const res = await get(`/v2/search?urgency=U-9&${M}`);
        expect(res.status).toBe(404);
        expect(searchMock).not.toHaveBeenCalled();
      },
    );

    it('POST /v2/search is a 404 when the flag is off', async () => {
      app = await boot(undefined);
      const res = await post(`/v2/search?query=rent&${M}`).send({});
      expect(res.status).toBe(404);
      expect(searchMock).not.toHaveBeenCalled();
    });
  });
});
