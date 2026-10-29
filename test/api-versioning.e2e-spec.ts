import {
  Controller,
  Get,
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
  Version,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
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

/** Stands in for any `@Version('1')` route, e.g. SearchController. */
@Controller('probe')
class VersionedProbeController {
  @Get()
  @Version('1')
  get() {
    return { ok: true };
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
      controllers: [HealthController, VersionedProbeController],
      providers: [HealthService],
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

    it('a versioned route answers without x-api-version, as version 1', async () => {
      const without = await request(app.getHttpServer()).get('/probe');
      const withOne = await request(app.getHttpServer())
        .get('/probe')
        .set('x-api-version', '1');
      expect(without.status).toBe(200);
      expect(without.body).toEqual(withOne.body);
    });

    it.each(['2', '9', 'v1', ''])(
      'x-api-version %p is a 400 that names the header, not a 404',
      async (value) => {
        const res = await request(app.getHttpServer())
          .get('/probe')
          .set('x-api-version', value);
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).toContain('x-api-version');
      },
    );

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
