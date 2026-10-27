import {
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import { ARCJET } from '@arcjet/nest';
import { getModelToken } from '@nestjs/mongoose';
import { SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HttpExceptionFilter } from 'src/common/filters/global-exception.filter';
import { TenantMiddleware } from 'src/common/middleware/TenantMiddleware';
import { Redirect } from 'src/common/schemas/redirect.schema';
import { Resource } from 'src/common/schemas/resource.schema';
import { buildSwaggerConfig } from 'src/common/swagger/swagger-config';
import { ResourceController } from 'src/resource/resource.controller';
import { ResourceService } from 'src/resource/resource.service';

/**
 * A re-keyed resource's old deep link (ISS-2514). The whole HTTP path runs:
 * the real ResourceService, the real controller and the global
 * HttpExceptionFilter, which once rebuilt every error body and dropped
 * `redirect`. Only the Mongo models are fakes, and they evaluate the filter
 * they are given, so a lookup that leaves out `tenantId` matches the other
 * tenant's row and goes red here.
 *
 * `@arcjet/nest` is ESM-only and is mocked as in service-tenant.e2e-spec.ts.
 */
jest.mock('@arcjet/nest', () => ({
  ARCJET: Symbol('ARCJET_MOCK'),
}));

const TENANT = 'aaaaaaaa-1111-4111-8111-111111111111';
const OTHER_TENANT = 'bbbbbbbb-2222-4222-8222-222222222222';
const NEW_ID = 'new-sal-0000';
const OLD_ID = 'old-sal-1111';
const OTHER_TENANTS_OLD_ID = 'old-sal-2222';
const UNKNOWN_ID = 'unknown-sal-3333';
const OLD_ORIGINAL_ID = 'old-original-4444';

type Doc = Record<string, unknown>;

const matches = (doc: Doc, filter: Doc) =>
  Object.entries(filter).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && '$in' in expected) {
      return (expected.$in as unknown[]).includes(doc[key]);
    }
    return doc[key] === expected;
  });

const resources: Doc[] = [
  {
    _id: 'mongo-new',
    serviceAtLocationId: NEW_ID,
    tenant_id: TENANT,
    displayName: 'Re-keyed resource',
    translations: [{ locale: 'en', displayName: 'Re-keyed resource' }],
  },
];

const redirects: Doc[] = [
  { _id: OLD_ID, newId: NEW_ID, tenantId: TENANT },
  { _id: OLD_ORIGINAL_ID, newId: NEW_ID, tenantId: TENANT },
  { _id: OTHER_TENANTS_OLD_ID, newId: NEW_ID, tenantId: OTHER_TENANT },
];

const query = (result: unknown) => {
  const chain = {
    lean: () => chain,
    exec: async () => result,
  };
  return chain;
};

const resourceModel = {
  aggregate: (pipeline: Doc[]) =>
    query(resources.filter((doc) => matches(doc, pipeline[0].$match as Doc))),
};

const redirectModel = {
  findOne: (filter: Doc) =>
    query(redirects.find((doc) => matches(doc, filter)) ?? null),
  findById: (id: string) =>
    query(redirects.find((doc) => doc._id === id) ?? null),
};

@Module({
  controllers: [ResourceController],
  providers: [
    TenantMiddleware,
    ResourceService,
    { provide: getModelToken(Resource.name), useValue: resourceModel },
    { provide: getModelToken(Redirect.name), useValue: redirectModel },
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
class ResourceRedirectTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes(ResourceController);
  }
}

describe('Resource redirect (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [ResourceRedirectTestModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (path: string, tenant = TENANT) =>
    request(app.getHttpServer())
      .get(path)
      .set('x-tenant-id', tenant)
      .set('accept-language', 'en');

  it('control: the new id resolves', async () => {
    const res = await get(`/resource/${NEW_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.serviceAtLocationId).toBe(NEW_ID);
  });

  it('missed id with a redirect row for this tenant -> 404 carrying redirect', async () => {
    const res = await get(`/resource/${OLD_ID}`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      status: 404,
      redirect: `/search/${NEW_ID}`,
      tenant: TENANT,
    });
  });

  it('missed original id with a redirect row for this tenant -> 404 carrying redirect', async () => {
    const res = await get(`/resource/original/${OLD_ORIGINAL_ID}`);
    expect(res.status).toBe(404);
    expect(res.body.redirect).toBe(`/search/${NEW_ID}`);
  });

  it('missed id without a redirect row -> 404 with no redirect', async () => {
    const res = await get(`/resource/${UNKNOWN_ID}`);
    expect(res.status).toBe(404);
    expect(res.body.status).toBe(404);
    expect(res.body).not.toHaveProperty('redirect');
  });

  it('missed id whose redirect row belongs to another tenant -> 404 with no redirect', async () => {
    const res = await get(`/resource/${OTHER_TENANTS_OLD_ID}`);
    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('redirect');
  });

  it("the other tenant's row still redirects that tenant", async () => {
    const res = await get(`/resource/${OTHER_TENANTS_OLD_ID}`, OTHER_TENANT);
    expect(res.status).toBe(404);
    expect(res.body.redirect).toBe(`/search/${NEW_ID}`);
  });
});

describe('Resource 404 body in the OpenAPI document', () => {
  let app: INestApplication;
  let document: any;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [ResourceRedirectTestModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    document = SwaggerModule.createDocument(app, buildSwaggerConfig());
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['/resource/{id}', '/resource/original/{id}'])(
    'GET %s documents its 404 body, with an optional redirect',
    (path) => {
      const notFound = document.paths[path].get.responses['404'];
      expect(notFound).toBeDefined();
      const ref: string = notFound.content['application/json'].schema.$ref;
      const schema =
        document.components.schemas[ref.replace('#/components/schemas/', '')];

      expect(Object.keys(schema.properties).sort()).toEqual(
        ['message', 'method', 'path', 'redirect', 'status', 'tenant'].sort(),
      );
      // Additive: every existing field required as before, redirect optional.
      expect(schema.required ?? []).not.toContain('redirect');
      expect(schema.properties.redirect.type).toBe('string');
    },
  );
});
