import {
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import { ARCJET } from '@arcjet/nest';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ServiceController } from 'src/service/service.controller';
import { ServiceDetailService } from 'src/service/service-detail.service';
import { TenantMiddleware } from 'src/common/middleware/TenantMiddleware';

/**
 * ServiceController must run TenantMiddleware: it is CDN-cached
 * (@SetCdnCacheTTL) and the CDN keys its cache on the URL only, so the
 * middleware's x-tenant-id validation and tenant_id/x-tenant-id
 * consistency check (400 on mismatch) are what prevents tenant A's URL
 * from being seeded with tenant B's response. It also sets
 * request.tenantId for the metrics tenant_id label.
 *
 * Uses a focused module because AppModule can't boot under ts-jest
 * (ESM-only ArcjetModule - see test/support/gateway-test-app.ts).
 * `@arcjet/nest` is mocked at module level so the real ESM-only package
 * is never loaded; the ArcjetGuard dependency is stubbed via its ARCJET
 * injection token.
 */
jest.mock('@arcjet/nest', () => ({
  ARCJET: Symbol('ARCJET_MOCK'),
}));

const TENANT = 'aaaaaaaa-1111-4111-8111-111111111111';

@Module({
  controllers: [ServiceController],
  providers: [
    TenantMiddleware,
    {
      provide: ServiceDetailService,
      useValue: {
        findById: jest.fn(async () => ({ id: 'svc-1' })),
      },
    },
    {
      provide: ARCJET,
      useValue: {
        protect: async () => ({
          isDenied: () => false,
          isErrored: () => false,
        }),
      },
    },
  ],
})
class ServiceTenantTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes(ServiceController);
  }
}

describe('ServiceController tenant middleware (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [ServiceTenantTestModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /service/:id without x-tenant-id -> 400', async () => {
    const res = await request(app.getHttpServer()).get('/service/svc-1');
    expect(res.status).toBe(400);
  });

  it('GET /service/:id with an invalid x-tenant-id -> 400', async () => {
    const res = await request(app.getHttpServer())
      .get('/service/svc-1')
      .set('x-tenant-id', 'not-a-uuid');
    expect(res.status).toBe(400);
  });

  it('GET /service/:id with tenant_id query not matching the header -> 400', async () => {
    const res = await request(app.getHttpServer())
      .get('/service/svc-1')
      .query({ tenant_id: 'bbbbbbbb-2222-4222-8222-222222222222' })
      .set('x-tenant-id', TENANT)
      .set('accept-language', 'en');
    expect(res.status).toBe(400);
  });

  it('GET /service/:id with a valid x-tenant-id reaches the handler', async () => {
    const res = await request(app.getHttpServer())
      .get('/service/svc-1')
      .set('x-tenant-id', TENANT)
      .set('accept-language', 'en');
    expect(res.status).toBe(200);
  });
});
