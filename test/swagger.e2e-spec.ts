import { Test } from '@nestjs/testing';
import { INestApplication, Module } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { buildSwaggerConfig } from 'src/common/swagger/swagger-config';
import { HealthController } from 'src/health/health.controller';
import { HealthService } from 'src/health/health.service';
import { FavoriteController } from 'src/favorite/favorite.controller';
import { FavoriteService } from 'src/favorite/favorite.service';
import { FavoriteListController } from 'src/favorite-list/favorite-list.controller';
import { FavoriteListService } from 'src/favorite-list/favorite-list.service';
import { KeycloakAuthService } from 'src/auth/services/keycloak-auth.service';
import { PrintableDirectoryController } from 'src/printable-directory/printable-directory.controller';
import { PrintableDirectoryPublicController } from 'src/printable-directory/printable-directory-public.controller';
import { PrintableDirectoryService } from 'src/printable-directory/printable-directory.service';

/**
 * Ticket 04's Swagger doc contract. Only wires up the controllers this
 * ticket actually touches (HealthController as the @Public() control,
 * FavoriteController/FavoriteListController/PrintableDirectory(Public)
 * Controller as the audited Keycloak/TenantMiddleware routes) with stub
 * providers - SwaggerModule.createDocument() only reflects decorator
 * metadata, it never calls a handler or a provider method, so stubs are
 * sufficient and avoid booting Mongo/Elasticsearch/Redis.
 */
async function buildSwaggerDocument() {
  @Module({
    controllers: [
      HealthController,
      FavoriteController,
      FavoriteListController,
      PrintableDirectoryController,
      PrintableDirectoryPublicController,
    ],
    providers: [
      { provide: HealthService, useValue: {} },
      { provide: FavoriteService, useValue: {} },
      { provide: FavoriteListService, useValue: {} },
      { provide: KeycloakAuthService, useValue: {} },
      { provide: PrintableDirectoryService, useValue: {} },
    ],
  })
  class SwaggerTestModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [SwaggerTestModule],
  }).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  await app.init();

  const document = SwaggerModule.createDocument(app, buildSwaggerConfig());
  return { app, document };
}

describe('Swagger document (e2e)', () => {
  let app: INestApplication;
  let document: any;

  beforeAll(async () => {
    ({ app, document } = await buildSwaggerDocument());
  });

  afterAll(async () => {
    await app.close();
  });

  it('documents X-API-Key as an optional apiKey scheme', () => {
    const schemes = document.components.securitySchemes;
    expect(schemes['X-API-Key']).toMatchObject({
      type: 'apiKey',
      in: 'header',
      name: 'X-API-Key',
    });
    // Optional: not referenced as a required `security` requirement on any
    // operation (R1 - documents, does not gate).
    for (const path of Object.values<any>(document.paths)) {
      for (const operation of Object.values<any>(path)) {
        const security = (operation.security ?? []).flatMap((s: any) =>
          Object.keys(s),
        );
        expect(security).not.toContain('X-API-Key');
      }
    }
  });

  it('documents Authorization via a bearer security scheme', () => {
    const schemes = document.components.securitySchemes;
    const bearerScheme = Object.values<any>(schemes).find(
      (s) => s.type === 'http' && s.scheme === 'bearer',
    );
    expect(bearerScheme).toBeDefined();
  });

  it('Keycloak-guarded FavoriteController routes carry the bearer security requirement', () => {
    const createOp = document.paths['/favorite']?.post;
    expect(createOp).toBeDefined();
    const securityKeys = (createOp.security ?? []).flatMap((s: any) =>
      Object.keys(s),
    );
    expect(securityKeys.length).toBeGreaterThan(0);
  });

  it('FavoriteController documents x-tenant-id as required', () => {
    const createOp = document.paths['/favorite']?.post;
    const headerParam = (createOp.parameters ?? []).find(
      (p: any) => p.name === 'x-tenant-id' && p.in === 'header',
    );
    expect(headerParam).toMatchObject({ required: true });
  });

  it('FavoriteController does NOT document accept-language (not in LocaleMiddleware coverage)', () => {
    const createOp = document.paths['/favorite']?.post;
    const headerParam = (createOp.parameters ?? []).find(
      (p: any) => p.name === 'accept-language' && p.in === 'header',
    );
    expect(headerParam).toBeUndefined();
  });

  it('FavoriteListController (Keycloak-guarded routes) document x-tenant-id, accept-language, and bearer auth', () => {
    const listOp = document.paths['/favorite-list']?.get;
    expect(listOp).toBeDefined();
    const names = (listOp.parameters ?? []).map((p: any) => p.name);
    expect(names).toContain('x-tenant-id');
    expect(names).toContain('accept-language');
    const securityKeys = (listOp.security ?? []).flatMap((s: any) =>
      Object.keys(s),
    );
    expect(securityKeys.length).toBeGreaterThan(0);
  });

  it('PrintableDirectoryController documents x-tenant-id, accept-language, and bearer auth', () => {
    const listOp = document.paths['/printable-directories']?.get;
    expect(listOp).toBeDefined();
    const names = (listOp.parameters ?? []).map((p: any) => p.name);
    expect(names).toContain('x-tenant-id');
    expect(names).toContain('accept-language');
    const securityKeys = (listOp.security ?? []).flatMap((s: any) =>
      Object.keys(s),
    );
    expect(securityKeys.length).toBeGreaterThan(0);
  });

  it('PrintableDirectoryPublicController documents x-tenant-id and accept-language, with no bearer requirement', () => {
    const previewOp =
      document.paths['/printable-directories/public/{slug}/preview']?.get;
    expect(previewOp).toBeDefined();
    const names = (previewOp.parameters ?? []).map((p: any) => p.name);
    expect(names).toContain('x-tenant-id');
    expect(names).toContain('accept-language');
    expect(previewOp.security ?? []).toEqual([]);
  });

  it('GET /health stays undocumented for any auth requirement (Public route)', () => {
    const healthOp = document.paths['/health']?.get;
    expect(healthOp).toBeDefined();
    expect(healthOp.security ?? []).toEqual([]);
  });
});
