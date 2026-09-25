import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ArcjetGuard } from 'src/common/guards/arcjet.guard';
import { MetricsService } from 'src/metrics/metrics.service';
import { RegionInternalModule } from 'src/region/internal/region.module';
import { ServiceDetailService } from 'src/service/service-detail.service';
import { ServiceController } from 'src/service/service.controller';
import { ServiceSearchInternalModule } from 'src/service/internal/service-search.module';
import { GatewayIdentityGuard } from './gateway-identity.guard';
import { GatewayPermissionsGuard } from './gateway-permissions.guard';
import { PermissionsSideChannelService } from './permissions-side-channel.service';
import { TenantScopeGuard } from './tenant-scope.guard';

// ESM-only, which ts-jest cannot load; ArcjetGuard is overridden below anyway.
jest.mock('@arcjet/nest', () => ({ ARCJET: 'ARCJET' }));

const KEY = 'internal-key-for-tests';

type Route = [string, (server: any) => request.Test];

/** The four Geography filter routes ServiceNet calls (ADR 0023/0024). */
const ROUTES: Route[] = [
  [
    'GET /internal/regions',
    (s) => request(s).get('/internal/regions?q=jack').set('x-api-version', '1'),
  ],
  [
    'GET /internal/regions/:id',
    (s) =>
      request(s).get('/internal/regions/state:MO').set('x-api-version', '1'),
  ],
  [
    'POST /internal/services/search',
    (s) =>
      request(s)
        .post('/internal/services/search')
        .set('x-api-version', '1')
        .send({ resourceWriterIds: ['writer-a'], limit: 10 }),
  ],
  [
    'POST /internal/services/facets',
    (s) =>
      request(s)
        .post('/internal/services/facets')
        .set('x-api-version', '1')
        .send({ resourceWriterIds: ['writer-a'] }),
  ],
];

const GATEWAY = {
  'x-connect211-identity-external-id': 'servicenet',
  'x-connect211-key-id': 'key_servicenet',
};

const MODES: [string, Record<string, string>][] = [
  ['gateway', GATEWAY],
  ['legacy', {}],
];

/**
 * The global gateway guards in AppModule's order, in front of the internal
 * routes and one existing tenant-scoped route: the internal routes answer to
 * the internal key instead of a tenant, and nothing else changes.
 */
describe('Geography filter internal routes: internal key, not tenant scope', () => {
  const search = jest.fn();
  const mget = jest.fn();

  async function buildApp(internalApiKey: string): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ internalApiKey })],
        }),
        ServiceSearchInternalModule,
        RegionInternalModule,
      ],
      controllers: [ServiceController],
      providers: [
        { provide: ServiceDetailService, useValue: { findById: jest.fn() } },
        {
          provide: MetricsService,
          useValue: { incrementSearchHit: jest.fn() },
        },
        {
          provide: PermissionsSideChannelService,
          useValue: { resolveSlugs: async () => ['norse-api.invoke'] },
        },
        { provide: APP_GUARD, useClass: GatewayIdentityGuard },
        { provide: APP_GUARD, useClass: GatewayPermissionsGuard },
        { provide: APP_GUARD, useClass: TenantScopeGuard },
      ],
    })
      .overrideProvider(ElasticsearchService)
      .useValue({ search, mget })
      .overrideGuard(ArcjetGuard)
      .useValue({ canActivate: () => true })
      .compile();

    const app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.enableVersioning({
      type: VersioningType.HEADER,
      header: 'x-api-version',
      defaultVersion: '1',
    });
    await app.init();
    return app;
  }

  beforeEach(() => {
    search.mockReset();
    search.mockResolvedValue({
      hits: { total: { value: 0 }, hits: [] },
      aggregations: {},
    });
    mget.mockReset();
    mget.mockImplementation(async ({ ids }: { ids: string[] }) => ({
      docs: ids.map((_id) => ({ _id, found: true })),
    }));
  });

  describe('with INTERNAL_API_KEY configured', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await buildApp(KEY);
    });
    afterAll(() => app.close());

    describe.each(MODES)('%s mode', (_mode, identity) => {
      describe.each(ROUTES)('%s', (_route, call) => {
        it('reaches the handler with the key and no x-tenant-id', async () => {
          const res = await call(app.getHttpServer())
            .set(identity)
            .set('x-internal-api-key', KEY);
          expect([400, 401, 403]).not.toContain(res.status);
          expect(search).toHaveBeenCalled();
        });

        it('401s without the key, before touching Elasticsearch', async () => {
          const res = await call(app.getHttpServer()).set(identity);
          expect(res.status).toBe(401);
          expect(search).not.toHaveBeenCalled();
        });

        it('401s with the wrong key, before touching Elasticsearch', async () => {
          const res = await call(app.getHttpServer())
            .set(identity)
            .set('x-internal-api-key', `${KEY}-wrong`);
          expect(res.status).toBe(401);
          expect(search).not.toHaveBeenCalled();
        });
      });
    });

    it('a tenant-scoped route still needs a tenant on the gateway path, key or not', async () => {
      const res = await request(app.getHttpServer())
        .get('/service/svc-1')
        .set('x-api-version', '1')
        .set(GATEWAY)
        .set('x-internal-api-key', KEY);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('tenant_target_required');
    });
  });

  describe.each([
    ['unset', undefined],
    ['empty', ''],
  ])('with INTERNAL_API_KEY %s', (_label, configured) => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await buildApp(configured as string);
    });
    afterAll(() => app.close());

    describe.each(MODES)('%s mode', (_mode, identity) => {
      it.each(ROUTES)('%s fails closed', async (_route, call) => {
        for (const sent of ['', 'anything', KEY]) {
          const req = call(app.getHttpServer()).set(identity);
          const res = await (sent ? req.set('x-internal-api-key', sent) : req);
          expect(res.status).toBe(401);
        }
        expect(search).not.toHaveBeenCalled();
      });
    });
  });
});
