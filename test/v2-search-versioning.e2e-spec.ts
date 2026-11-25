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
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
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
import { V2SearchService } from 'src/v2/search/v2-search.service';
import { V1_AND_LEGACY } from 'src/common/versioning/api-version';
import { TenantConfigService } from 'src/cms-config/tenant-config.service';
import { GatewayIdentityGuard } from 'src/auth/gateway/gateway-identity.guard';
import { GatewayPermissionsGuard } from 'src/auth/gateway/gateway-permissions.guard';
import { PermissionsSideChannelService } from 'src/auth/gateway/permissions-side-channel.service';
import { TenantScopeGuard } from 'src/auth/gateway/tenant-scope.guard';

/** Stands in for the v1 SearchController, which has the same path. */
@Controller('search')
class V1SearchStubController {
  @Get()
  @Version(V1_AND_LEGACY)
  @SetCdnCacheTTL(ONE_HOUR)
  get() {
    return { route: 'v1' };
  }
}

const TENANT = '11111111-1111-4111-8111-111111111111';
/** The URL copies of the x-tenant-id and accept-language headers. */
const M = `tenant_id=${TENANT}&locale=en`;

/** The gateway guards; the key `key-a` may read TENANT only. */
const GATEWAY_PROVIDERS = [
  { provide: APP_GUARD, useClass: GatewayIdentityGuard },
  {
    provide: PermissionsSideChannelService,
    useValue: {
      resolveSlugs: async () => [`norse-api.${TENANT}.read`],
    },
  },
  { provide: APP_GUARD, useClass: GatewayPermissionsGuard },
  { provide: APP_GUARD, useClass: TenantScopeGuard },
];

/**
 * The real V2SearchController (its real decorators and guards) behind a fake
 * V2SearchService, next to a v1 stub on the same path, under the real
 * configureHttp and ApiVersionMiddleware. AppModule cannot boot under ts-jest
 * (ESM-only ArcjetModule, see test/support/gateway-test-app.ts).
 */
describe('v2 search versioning (e2e)', () => {
  let app: INestApplication;
  const searchMock = jest.fn();

  const pinsMock = jest.fn();
  /** A tenant with no `enable_v2_api`. The route must not ask. */
  const tenantConfig = {
    getSearchConfig: jest.fn(async () => ({})),
    isV2Tenant: jest.fn(async () => false),
  };

  /** `flag` is the raw V2_SEARCH_ENABLED value; `gateway` adds the real APP_GUARDs. */
  async function boot(flag?: string, gateway = false) {
    @Module({
      controllers: [V1SearchStubController, V2SearchController],
      providers: [
        ...(gateway ? GATEWAY_PROVIDERS : []),
        { provide: TenantConfigService, useValue: tenantConfig },
        { provide: APP_INTERCEPTOR, useClass: CdnCacheControlInterceptor },
        {
          provide: V2SearchService,
          useValue: { search: searchMock, pins: pinsMock },
        },
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
    pinsMock.mockReset();
    pinsMock.mockResolvedValue({ route: 'v2-pins' });
    tenantConfig.getSearchConfig.mockClear();
    tenantConfig.isV2Tenant.mockClear();
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

    it('/v2/search with x-api-version: 1 ignores the header', async () => {
      const res = await get(`/v2/search?query=rent&${M}`, '1');
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

    // ISS-2496 (Lucas, decision 3): the header no longer picks v2.
    it.each([
      ['GET', '/search?query=rent'],
      ['GET', `/v2/search?query=rent&${M}`],
      ['GET', '/v1/search?query=rent'],
      ['POST', '/search?query=rent'],
      ['POST', `/v2/search?query=rent&${M}`],
    ])(
      '%s %s with x-api-version: 2 is a 400 that names the header',
      async (method, path) => {
        const res =
          method === 'GET'
            ? await get(path, '2')
            : await post(path, '2').send({});
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).toContain('x-api-version');
        expect(searchMock).not.toHaveBeenCalled();
      },
    );

    it.each(['/search', '/v1/search'])(
      '%s without a header reaches the v1 route',
      async (path) => {
        const res = await get(path);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ route: 'v1' });
        expect(searchMock).not.toHaveBeenCalled();
      },
    );

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

  // ADR 0039 Decision 28 and ISS-2496: one URL answers one version, so
  // nothing varies on x-api-version, and an emergency answer is never stored.
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

    it.each(['/search?query=rent', '/v1/search?query=rent'])(
      '%s for v1 is stored, with no Vary on the version',
      async (path) => {
        const res = await get(path);
        expect(res.body.route).toBe('v1');
        expect(res.headers['cache-control']).toMatch(/^public, /);
        expect(res.headers['vary'] ?? '').not.toMatch(/x-api-version/i);
      },
    );
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

    it('both present and matching reach the route', async () => {
      const res = await get(`/v2/search?query=rent&${M}`);
      expect(res.status).toBe(200);
      expect(searchMock).toHaveBeenCalledTimes(1);
    });

    // ADR 0039 Decision 34: the URL wins; the headers are not read on v2.
    const bare = (path: string) => request(app.getHttpServer()).get(path);

    it('the URL alone reaches the route, with no tenant or language header', async () => {
      const res = await bare(`/v2/search?query=rent&${M}`);
      expect(res.status).toBe(200);
      expect(searchMock).toHaveBeenCalledTimes(1);
      const { headers } = searchMock.mock.calls[0][0];
      expect(headers['x-tenant-id']).toBe(TENANT);
      expect(headers['accept-language']).toBe('en');
    });

    it('a tenant_id that differs from x-tenant-id wins: the header is not read', async () => {
      const other = '22222222-2222-4222-8222-222222222222';
      const res = await get(
        `/v2/search?query=rent&tenant_id=${other}&locale=en`,
      );
      expect(res.status).toBe(200);
      expect(searchMock.mock.calls[0][0].headers['x-tenant-id']).toBe(other);
    });

    it('a locale that differs from accept-language wins: the header is not read', async () => {
      const res = await get(
        `/v2/search?query=rent&tenant_id=${TENANT}&locale=es`,
      );
      expect(res.status).toBe(200);
      expect(searchMock.mock.calls[0][0].headers['accept-language']).toBe('es');
    });

    it('a tenant_id that is not a UUID is a 400 that names it', async () => {
      refused(
        await get('/v2/search?query=rent&tenant_id=abc&locale=en'),
        'tenant_id',
      );
    });

    it('a locale that is not one exact supported code is a 400 that names locale', async () => {
      refused(
        await get(`/v2/search?query=rent&tenant_id=${TENANT}&locale=en-US`),
        'locale',
      );
    });

    it('v1 /search still reads the headers and still checks a URL copy', async () => {
      const other = '22222222-2222-4222-8222-222222222222';
      const res = await get(`/search?query=rent&tenant_id=${other}`);
      expect(res.status).toBe(400);
    });

    it('v1 /search is unchanged: no copies needed', async () => {
      const res = await get('/search?query=rent');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ route: 'v1' });
    });
  });

  describe('global switch V2_SEARCH_ENABLED', () => {
    const geometry = { type: 'Point', coordinates: [1, 2] };
    const routes: [string, () => request.Test][] = [
      ['GET /v2/search', () => get(`/v2/search?query=rent&${M}`)],
      [
        'POST /v2/search',
        () => post(`/v2/search?query=rent&${M}`).send({ geometry }),
      ],
      ['GET /v2/search/pins', () => get(`/v2/search/pins?query=rent&${M}`)],
    ];
    const badRequests: [string, () => request.Test][] = [
      ['GET /v2/search', () => get(`/v2/search?urgency=U-9&${M}`)],
      [
        'POST /v2/search',
        () => post(`/v2/search?urgency=U-9&${M}`).send({ geometry }),
      ],
      ['GET /v2/search/pins', () => get(`/v2/search/pins?urgency=U-9&${M}`)],
      ['GET /v2/search without tenant_id', () => get('/v2/search?locale=en')],
    ];
    const OFF = [undefined, '', 'false', 'TRUE'];

    describe.each(OFF)('value %p', (flag) => {
      beforeEach(async () => {
        app = await boot(flag);
      });

      it.each(routes)('%s is a 404', async (_name, call) => {
        const res = await call();
        expect(res.status).toBe(404);
        expect(searchMock).not.toHaveBeenCalled();
        expect(pinsMock).not.toHaveBeenCalled();
      });

      it.each(badRequests)(
        '%s with a bad query is a 404, before validation',
        async (_name, call) => {
          const res = await call();
          expect(res.status).toBe(404);
        },
      );

      it.each(['/search', '/v1/search'])(
        '%s still reaches the v1 route',
        async (path) => {
          const res = await get(path);
          expect(res.status).toBe(200);
          expect(res.body).toEqual({ route: 'v1' });
        },
      );
    });

    describe("value 'true'", () => {
      beforeEach(async () => {
        app = await boot('true');
      });

      it.each(routes)(
        '%s lets a tenant with no enable_v2_api through; no guard reads its config',
        async (_name, call) => {
          const res = await call();
          expect(res.status).toBe(200);
          expect(res.body.route).toMatch(/^v2/);
          expect(tenantConfig.getSearchConfig).not.toHaveBeenCalled();
          expect(tenantConfig.isV2Tenant).not.toHaveBeenCalled();
        },
      );

      it.each(badRequests)(
        '%s with a bad query is a 400',
        async (_name, call) => {
          const res = await call();
          expect(res.status).toBe(400);
          expect(searchMock).not.toHaveBeenCalled();
          expect(pinsMock).not.toHaveBeenCalled();
        },
      );
    });
  });

  /**
   * With one global switch, the gateway's per-key tenant scope is what keeps a
   * key inside its own tenants. The three real APP_GUARDs, in AppModule order.
   */
  describe('gateway tenant scope on /v2/search', () => {
    const OTHER = '22222222-2222-4222-8222-222222222222';
    const asKey = (path: string, headerTenant?: string) => {
      const req = request(app.getHttpServer())
        .get(path)
        .set('x-connect211-identity-external-id', 'ext-a')
        .set('x-connect211-key-id', 'key-a');
      if (headerTenant) req.set('x-tenant-id', headerTenant);
      return req;
    };

    beforeEach(async () => {
      app = await boot('true', true);
    });

    it.each(['/v2/search', '/v2/search/pins'])(
      'GET %s: the key of tenant A reads tenant A',
      async (path) => {
        const res = await asKey(`${path}?query=rent&${M}`);
        expect(res.status).toBe(200);
      },
    );

    it.each([
      ['/v2/search', undefined],
      ['/v2/search', TENANT],
      ['/v2/search', OTHER],
      ['/v2/search/pins', undefined],
      ['/v2/search/pins', TENANT],
    ])(
      'GET %s: the key of tenant A asking tenant B is a 403 (x-tenant-id %p)',
      async (path, header) => {
        const res = await asKey(
          `${path}?query=rent&tenant_id=${OTHER}&locale=en`,
          header,
        );
        expect(res.status).toBe(403);
        expect(res.body.message).toBe('tenant_scope_denied');
        expect(searchMock).not.toHaveBeenCalled();
        expect(pinsMock).not.toHaveBeenCalled();
      },
    );

    // As on v1: the scope guard asks for `.write` on every POST.
    it.each([TENANT, OTHER])(
      'POST /v2/search with a read-only key is a 403 (tenant %s)',
      async (tenant) => {
        const res = await request(app.getHttpServer())
          .post(`/v2/search?query=rent&tenant_id=${tenant}&locale=en`)
          .set('x-connect211-identity-external-id', 'ext-a')
          .set('x-connect211-key-id', 'key-a')
          .send({});
        expect(res.status).toBe(403);
        expect(searchMock).not.toHaveBeenCalled();
      },
    );
  });
});
