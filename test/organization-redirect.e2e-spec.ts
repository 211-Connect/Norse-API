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
import { Organization } from 'src/common/schemas/organization.schema';
import { Redirect } from 'src/common/schemas/redirect.schema';
import { buildSwaggerConfig } from 'src/common/swagger/swagger-config';
import { OrganizationController } from 'src/organization/organization.controller';
import { OrganizationDetailService } from 'src/organization/organization-detail.service';
import { OrganizationService } from 'src/organization/organization.service';

/**
 * A re-keyed organization's old id (ISS-2517). GET /organization/:id runs the
 * real controller, detail service and HttpExceptionFilter. The models are
 * fakes that evaluate the filter they are given, so a redirect lookup that
 * leaves out the tenant matches the other tenant's row and goes red here.
 * The redirect target is Norse's organization destination, the org-scoped
 * search, not the resource URL `/search/<id>` it used to be.
 */
jest.mock('@arcjet/nest', () => ({
  ARCJET: Symbol('ARCJET_MOCK'),
}));

const TENANT = 'aaaaaaaa-1111-4111-8111-111111111111';
const OTHER_TENANT = 'bbbbbbbb-2222-4222-8222-222222222222';
const NEW_ORG = 'new-org-0000';
const OLD_ORG = 'old-org-1111';
const OTHER_TENANTS_OLD_ORG = 'old-org-2222';
const UNKNOWN_ORG = 'unknown-org-3333';

type Doc = Record<string, unknown>;

const matches = (doc: Doc, filter: Doc) =>
  Object.entries(filter).every(([key, expected]) => doc[key] === expected);

const query = (result: unknown) => {
  const chain = { lean: () => chain, exec: async () => result };
  return chain;
};

const organizations: Doc[] = [
  { _id: 'mongo-new-org', organizationId: NEW_ORG, tenant_id: TENANT },
];
const redirects: Doc[] = [
  { _id: OLD_ORG, newId: NEW_ORG, tenantId: TENANT },
  { _id: OTHER_TENANTS_OLD_ORG, newId: NEW_ORG, tenantId: OTHER_TENANT },
];

@Module({
  controllers: [OrganizationController],
  providers: [
    TenantMiddleware,
    OrganizationDetailService,
    { provide: OrganizationService, useValue: {} },
    {
      provide: getModelToken(Organization.name),
      useValue: {
        aggregate: (pipeline: Doc[]) =>
          query(
            organizations.filter((doc) =>
              matches(doc, pipeline[0].$match as Doc),
            ),
          ),
      },
    },
    {
      provide: getModelToken(Redirect.name),
      useValue: {
        findOne: (filter: Doc) =>
          query(redirects.find((doc) => matches(doc, filter)) ?? null),
        findById: (id: string) =>
          query(redirects.find((doc) => doc._id === id) ?? null),
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
class OrganizationRedirectTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes(OrganizationController);
  }
}

describe('Organization redirect (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [OrganizationRedirectTestModule],
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
    const res = await get(`/organization/${NEW_ORG}`);
    expect(res.status).toBe(200);
    expect(res.body.organizationId).toBe(NEW_ORG);
  });

  it('old id with a redirect row -> 404 naming the org-scoped search', async () => {
    const res = await get(`/organization/${OLD_ORG}`);
    expect(res.status).toBe(404);
    expect(res.body.redirect).toBe(`/search?organization_id=${NEW_ORG}`);
  });

  it('unknown id -> 404 with no redirect', async () => {
    const res = await get(`/organization/${UNKNOWN_ORG}`);
    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('redirect');
  });

  it("another tenant's row is not followed", async () => {
    const res = await get(`/organization/${OTHER_TENANTS_OLD_ORG}`);
    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('redirect');
  });

  it('documents the 404 body with an optional redirect', async () => {
    const document: any = SwaggerModule.createDocument(
      app,
      buildSwaggerConfig(),
    );
    const notFound = document.paths['/organization/{id}'].get.responses['404'];
    const ref: string = notFound.content['application/json'].schema.$ref;
    const schema =
      document.components.schemas[ref.replace('#/components/schemas/', '')];
    expect(schema.properties.redirect.type).toBe('string');
    expect(schema.required ?? []).not.toContain('redirect');
  });
});
