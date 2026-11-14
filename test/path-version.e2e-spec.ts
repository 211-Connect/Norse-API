import {
  Body,
  Controller,
  Get,
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
  Param,
  Post,
  Query,
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
import { SUPPORTED_API_VERSIONS } from 'src/common/versioning/api-version';
import { usePathVersion } from 'src/common/versioning/path-version';
import { useInternalServicesBodyLimit } from 'src/service/internal/internal-services-body';

/**
 * Test-only stand-ins. The real SearchController and ResourceController sit
 * behind ArcjetGuard (ESM-only, cannot load under ts-jest: see
 * test/support/gateway-test-app.ts), so these copy their shape: a `@Version`
 * route on `search` and on `resource/:id`. The v2 route is a test-only
 * handler: `development` has no `@Version('2')` handler yet (it is in PR #279).
 */
@Controller('search')
class SearchProbeController {
  @Get()
  @Version('1')
  v1(@Query() query: Record<string, string>) {
    return { version: 1, query };
  }

  @Get()
  @Version('2')
  v2(@Query() query: Record<string, string>) {
    return { version: 2, query };
  }

  @Post()
  @Version('1')
  post(@Body() body: unknown, @Query() query: Record<string, string>) {
    return { version: 1, body, query };
  }
}

@Controller('resource')
class ResourceProbeController {
  @Get(':id')
  @Version('1')
  get(@Param('id') id: string) {
    return { version: 1, id };
  }
}

@Controller('internal/services')
class InternalServicesProbeController {
  @Post()
  @Version('1')
  post(@Body() body: { blob: string }) {
    return { length: body.blob.length };
  }
}

async function boot(supported?: readonly string[]): Promise<INestApplication> {
  @Module({
    controllers: [
      HealthController,
      SearchProbeController,
      ResourceProbeController,
      InternalServicesProbeController,
    ],
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
  const app = moduleRef.createNestApplication();
  // The same order main.ts uses: path version first, then the body limit.
  usePathVersion(app, supported);
  useInternalServicesBodyLimit(app);
  app.useGlobalFilters(new HttpExceptionFilter());
  configureHttp(app);
  await app.init();
  return app;
}

describe('version in the path (ISS-2496, e2e)', () => {
  let app: INestApplication;

  // `development` declares no route under version 2 yet, so SUPPORTED is
  // ['1']. PR #279 adds '2'. Do the same here, and put it back afterwards.
  const mutable = SUPPORTED_API_VERSIONS as string[];
  const savedSupported = [...mutable];

  beforeAll(async () => {
    mutable.push('2');
    app = await boot();
  });
  afterAll(async () => {
    await app.close();
    mutable.splice(0, mutable.length, ...savedSupported);
  });

  const server = () => app.getHttpServer();

  describe.each([
    ['search', '/search?query=food&lat=1.5&lng=2'],
    ['resource', '/resource/abc-123'],
  ])('%s route, v1', (_name, route) => {
    it('/v1 form, header form and bare form give one status and body', async () => {
      const bare = await request(server()).get(route);
      const header = await request(server())
        .get(route)
        .set('x-api-version', '1');
      const path = await request(server()).get(`/v1${route}`);
      expect(bare.status).toBe(200);
      expect(path.status).toBe(bare.status);
      expect(path.body).toEqual(bare.body);
      expect(header.status).toBe(bare.status);
      expect(header.body).toEqual(bare.body);
    });

    it('the path beats a conflicting header', async () => {
      const res = await request(server())
        .get(`/v1${route}`)
        .set('x-api-version', '2');
      expect(res.status).toBe(200);
      expect(res.body.version).toBe(1);
    });

    it('the path beats an invalid header', async () => {
      const res = await request(server())
        .get(`/v1${route}`)
        .set('x-api-version', '9');
      expect(res.status).toBe(200);
    });
  });

  describe('v2 (test-only handler)', () => {
    it('/v2/search reaches the version 2 handler, same as the v2 header', async () => {
      const path = await request(server()).get('/v2/search?query=a');
      const header = await request(server())
        .get('/search?query=a')
        .set('x-api-version', '2');
      expect(path.status).toBe(200);
      expect(path.body).toEqual({ version: 2, query: { query: 'a' } });
      expect(header.body).toEqual(path.body);
    });

    it('the path beats a v1 header', async () => {
      const res = await request(server())
        .get('/v2/search')
        .set('x-api-version', '1');
      expect(res.body.version).toBe(2);
    });
  });

  describe('header alone, and no version', () => {
    it('the header alone still picks the version', async () => {
      const v1 = await request(server())
        .get('/search')
        .set('x-api-version', '1');
      const v2 = await request(server())
        .get('/search')
        .set('x-api-version', '2');
      expect(v1.body.version).toBe(1);
      expect(v2.body.version).toBe(2);
    });

    it('no version at all is version 1', async () => {
      const res = await request(server()).get('/search');
      expect(res.status).toBe(200);
      expect(res.body.version).toBe(1);
    });

    it('an unknown header value is still a 400 that names the header', async () => {
      const res = await request(server())
        .get('/search')
        .set('x-api-version', '9');
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('x-api-version');
    });
  });

  describe('unknown prefix', () => {
    it.each(['/v9/search', '/v0/search', '/v1x/search', '/V1/search'])(
      '%s is a 404, as any unknown path',
      async (path) => {
        const res = await request(server()).get(path);
        const unknown = await request(server()).get('/no-such-route');
        expect(res.status).toBe(404);
        expect(unknown.status).toBe(404);
      },
    );
  });

  describe('query string and body survive the rewrite', () => {
    it('keeps repeated and encoded query parameters', async () => {
      const q = '?query=caf%C3%A9%20s&taxonomies=a&taxonomies=b&page=2';
      const bare = await request(server()).get(`/search${q}`);
      const path = await request(server()).get(`/v1/search${q}`);
      expect(path.body).toEqual(bare.body);
      expect(path.body.query.query).toBe('café s');
    });

    it('keeps a POST JSON body and query', async () => {
      const payload = { a: 1, nested: { b: ['x', 'y'] } };
      const bare = await request(server()).post('/search?z=1').send(payload);
      const path = await request(server()).post('/v1/search?z=1').send(payload);
      expect(path.status).toBe(bare.status);
      expect(path.body).toEqual(bare.body);
      expect(path.body.body).toEqual(payload);
    });

    it('/v1/internal/services keeps its 5 MB body limit', async () => {
      const blob = 'x'.repeat(200 * 1024);
      const bare = await request(server())
        .post('/internal/services')
        .send({ blob });
      const path = await request(server())
        .post('/v1/internal/services')
        .send({ blob });
      expect(bare.status).toBe(201);
      expect(path.status).toBe(201);
      expect(path.body).toEqual({ length: blob.length });
    });
  });

  describe('version neutral routes', () => {
    it('/v1/health answers like /health', async () => {
      const bare = await request(server()).get('/health');
      const path = await request(server()).get('/v1/health');
      expect(path.status).toBe(200);
      expect(path.body).toEqual(bare.body);
    });
  });

  describe('error bodies', () => {
    it('echo the path the caller sent', async () => {
      const res = await request(server()).get('/v1/no-such-route');
      expect(res.status).toBe(404);
      expect(res.body.path).toBe('/v1/no-such-route');
    });
  });
});

describe('version in the path, on a server where only version 1 exists (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await boot(['1']);
  });
  afterAll(async () => {
    await app.close();
  });

  it('/v1 works', async () => {
    const res = await request(app.getHttpServer()).get('/v1/search');
    expect(res.status).toBe(200);
  });

  it('/v2 is a 404 until a route is declared under version 2', async () => {
    const res = await request(app.getHttpServer()).get('/v2/search');
    expect(res.status).toBe(404);
  });
});
