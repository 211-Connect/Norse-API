import {
  Body,
  Controller,
  Get,
  INestApplication,
  Injectable,
  MiddlewareConsumer,
  Module,
  NestMiddleware,
  NestModule,
  Param,
  Post,
  Query,
  Version,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { HealthController } from 'src/health/health.controller';
import { HealthService } from 'src/health/health.service';
import { HttpExceptionFilter } from 'src/common/filters/global-exception.filter';
import {
  ApiVersionMiddleware,
  API_VERSION_MIDDLEWARE_ROUTES,
} from 'src/common/middleware/ApiVersionMiddleware';
import { configureHttp } from 'src/common/http/configure-http';
import { RELEASE_HEADER } from 'src/common/release/release-info';
import { V1_AND_LEGACY } from 'src/common/versioning/api-version';
import { useInternalServicesBodyLimit } from 'src/service/internal/internal-services-body';

/**
 * Stands in for a v1 route such as SearchController or ResourceController
 * (the real ones sit behind ArcjetGuard, ESM-only, which cannot load under
 * ts-jest: see test/support/gateway-test-app.ts).
 */
@Controller('probe')
class VersionedProbeController {
  @Get()
  @Version(V1_AND_LEGACY)
  get(@Query() query: Record<string, string | string[]>) {
    return { ok: true, query };
  }

  @Get(':id')
  @Version(V1_AND_LEGACY)
  one(@Param('id') id: string) {
    return { id };
  }

  @Post()
  @Version(V1_AND_LEGACY)
  post(@Body() body: unknown) {
    return { body };
  }
}

/** A controller that declares no version gets the default, V1_AND_LEGACY. */
@Controller('plain')
class UnversionedProbeController {
  @Get()
  get() {
    return { plain: true };
  }
}

@Controller('internal/services')
class InternalServicesProbeController {
  @Post()
  @Version(V1_AND_LEGACY)
  post(@Body() body: { blob: string }) {
    return { length: body.blob.length };
  }
}

/** Like TenantMiddleware: applied per controller, so it must see both paths. */
@Injectable()
class ControllerScopedMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction) {
    res.setHeader('x-probe-middleware', 'ran');
    next();
  }
}

/**
 * ISS-2481 and ISS-2482. Boots the real `configureHttp` (what main.ts calls)
 * and the real ApiVersionMiddleware on the same routes AppModule applies it
 * to. AppModule itself cannot boot under ts-jest (ESM-only ArcjetModule, see
 * test/support/gateway-test-app.ts).
 */
describe('API versioning and release header (e2e)', () => {
  let app: INestApplication;
  const saved = { version: process.env.APP_VERSION, sha: process.env.GIT_SHA };

  async function boot() {
    @Module({
      controllers: [
        HealthController,
        VersionedProbeController,
        UnversionedProbeController,
        InternalServicesProbeController,
      ],
      providers: [HealthService],
    })
    class TestModule implements NestModule {
      configure(consumer: MiddlewareConsumer) {
        consumer
          .apply(ApiVersionMiddleware)
          .forRoutes(API_VERSION_MIDDLEWARE_ROUTES);
        consumer
          .apply(ControllerScopedMiddleware)
          .forRoutes(VersionedProbeController);
      }
    }
    const moduleRef = await Test.createTestingModule({
      imports: [TestModule],
    }).compile();
    const nestApp = moduleRef.createNestApplication();
    // The same order main.ts uses.
    useInternalServicesBodyLimit(nestApp);
    nestApp.useGlobalFilters(new HttpExceptionFilter());
    configureHttp(nestApp);
    await nestApp.init();
    return nestApp;
  }

  afterEach(async () => {
    await app?.close();
    process.env.APP_VERSION = saved.version;
    process.env.GIT_SHA = saved.sha;
    if (saved.version === undefined) delete process.env.APP_VERSION;
    if (saved.sha === undefined) delete process.env.GIT_SHA;
  });

  describe('with release env set', () => {
    beforeEach(async () => {
      process.env.APP_VERSION = 'v9.8.7';
      process.env.GIT_SHA = 'abc1234def';
      app = await boot();
    });

    const server = () => app.getHttpServer();

    // ISS-2496: real /v1 routes, and the legacy unversioned path during the
    // transition (the gateway strips /norse-api/v1 until the chart sets
    // versionPrefix "").
    it.each([
      [
        '/probe?query=food&lat=1.5',
        { ok: true, query: { query: 'food', lat: '1.5' } },
      ],
      [
        '/probe?x=1&x=2&q=a%20b',
        { ok: true, query: { x: ['1', '2'], q: 'a b' } },
      ],
      ['/probe/abc-123', { id: 'abc-123' }],
      ['/plain', { plain: true }],
    ])(
      '%s answers the same at /v1, bare, and bare with x-api-version: 1',
      async (route, body) => {
        const bare = await request(server()).get(route);
        const path = await request(server()).get(`/v1${route}`);
        const header = await request(server())
          .get(route)
          .set('x-api-version', '1');
        for (const res of [bare, path, header]) {
          expect(res.status).toBe(200);
          expect(res.body).toEqual(body);
        }
      },
    );

    it('x-api-version: 1 on a /v1 path is ignored', async () => {
      const res = await request(server())
        .get('/v1/probe')
        .set('x-api-version', '1');
      expect(res.status).toBe(200);
    });

    it('a POST body reaches the handler on both paths', async () => {
      for (const path of ['/probe', '/v1/probe']) {
        const res = await request(server()).post(path).send({ a: 1 });
        expect(res.status).toBe(201);
        expect(res.body).toEqual({ body: { a: 1 } });
      }
    });

    it('a controller-scoped middleware runs on both paths', async () => {
      for (const path of ['/probe', '/v1/probe', '/v1/probe/x']) {
        const res = await request(server()).get(path);
        expect(res.headers['x-probe-middleware']).toBe('ran');
      }
    });

    it('/v1/internal/services keeps the 5 MB body limit', async () => {
      const blob = 'x'.repeat(1024 * 1024);
      for (const path of ['/internal/services', '/v1/internal/services']) {
        const res = await request(server()).post(path).send({ blob });
        expect(res.status).toBe(201);
        expect(res.body).toEqual({ length: blob.length });
      }
    });

    it('an error body keeps the path the caller sent', async () => {
      const res = await request(server()).get('/v1/nope');
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).toContain('/v1/nope');
    });

    it.each([
      '/v2/probe',
      '/v9/probe',
      '/v0/probe',
      '/v01/probe',
      '/v1x/probe',
      '/v1/v1/probe',
      '/vv1/probe',
    ])('%s is a plain 404: no route is declared there', async (path) => {
      const res = await request(server()).get(path);
      expect(res.status).toBe(404);
    });

    it.each(['2', '3', '9', 'v1', ''])(
      'x-api-version %p is a 400 that names the header, not a 404',
      async (value) => {
        for (const path of ['/probe', '/v1/probe']) {
          const res = await request(server())
            .get(path)
            .set('x-api-version', value);
          expect(res.status).toBe(400);
          expect(JSON.stringify(res.body)).toContain('x-api-version');
        }
      },
    );

    it('/v1/health answers like /health', async () => {
      const res = await request(server()).get('/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('up');
    });

    it('/health reports the release and commit', async () => {
      const res = await request(app.getHttpServer()).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: 'up',
        release: 'v9.8.7',
        commit: 'abc1234def',
      });
    });

    it.each([
      ['a 200', '/probe', undefined],
      ['a 400', '/probe', '9'],
      ['a 404', '/no-such-route', undefined],
      ['/health', '/health', undefined],
    ])('%s carries the release header', async (_label, path, version) => {
      const req = request(app.getHttpServer()).get(path);
      if (version !== undefined) req.set('x-api-version', version);
      const res = await req;
      expect(res.headers[RELEASE_HEADER]).toBe('v9.8.7');
    });

    it('browser callers can read the release header (CORS)', async () => {
      const res = await request(app.getHttpServer())
        .get('/probe')
        .set('Origin', 'https://example.org');
      expect(res.headers['access-control-expose-headers']).toContain(
        RELEASE_HEADER,
      );
    });
  });

  describe('without release env (a local build)', () => {
    beforeEach(async () => {
      delete process.env.APP_VERSION;
      delete process.env.GIT_SHA;
      app = await boot();
    });

    it('reports unknown rather than a guessed version', async () => {
      const res = await request(app.getHttpServer()).get('/health');
      expect(res.body).toEqual({
        status: 'up',
        release: 'unknown',
        commit: 'unknown',
      });
      expect(res.headers[RELEASE_HEADER]).toBe('unknown');
    });
  });
});
