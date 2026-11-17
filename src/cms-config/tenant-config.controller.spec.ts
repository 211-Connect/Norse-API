import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { TenantConfigController } from './tenant-config.controller';
import { TenantConfigService } from './tenant-config.service';
import { OrchestrationConfigController } from './orchestration-config.controller';
import { OrchestrationConfigService } from './orchestration-config.service';
import { CmsConfigController } from './cms-config.controller';
import { buildSwaggerConfig } from '../common/swagger/swagger-config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { GatewayIdentityGuard } from '../auth/gateway/gateway-identity.guard';
import { GatewayPermissionsGuard } from '../auth/gateway/gateway-permissions.guard';
import { PermissionsSideChannelService } from '../auth/gateway/permissions-side-channel.service';
import { UnauthorizedException } from '@nestjs/common';
import { apiVersioningOptions } from 'src/common/versioning/api-version';

const INTERNAL_API_KEY = 'internal-key-for-tests';

describe('TenantConfigController', () => {
  let app: INestApplication;
  let tenantConfigService: {
    getTenantLocales: jest.Mock;
    getFacets: jest.Mock;
    getTopics: jest.Mock;
    getSuggestions: jest.Mock;
    getSearchConfig: jest.Mock;
    getOrchestrationConfig: jest.Mock;
  };

  beforeEach(async () => {
    tenantConfigService = {
      getTenantLocales: jest.fn().mockResolvedValue(['en', 'es']),
      getFacets: jest
        .fn()
        .mockResolvedValue([
          { facet: 'age_groups', name: 'Age Groups', es: 'Grupos de edad' },
        ]),
      getTopics: jest.fn().mockResolvedValue({
        tenantId: 'tenant-1',
        iconSize: 'medium',
        imageBorderRadius: '8px',
        backTexts: { en: 'Back' },
        customHeadings: { en: 'Help' },
        list: [
          {
            id: 'topic-1',
            name: 'Housing',
            names: { en: 'Housing', es: 'Vivienda' },
            subtopics: [
              {
                id: 'sub-1',
                name: 'Emergency Shelter',
                names: { en: 'Emergency Shelter' },
              },
            ],
          },
        ],
      }),
      getSuggestions: jest.fn().mockResolvedValue({
        tenantId: 'tenant-1',
        suggestions: [
          {
            id: 'suggestion-1',
            taxonomies: 'BD-1800',
            value: 'Emergency Shelter',
            values: { en: 'Emergency Shelter', es: 'Refugio de Emergencia' },
          },
        ],
      }),
      getSearchConfig: jest.fn().mockResolvedValue({
        pinned_resources_mode: 'boost',
        enable_organization_search: true,
      }),
      getOrchestrationConfig: jest.fn().mockResolvedValue({
        tenantId: 'tenant-1',
        schemas: [],
      }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ internalApiKey: INTERNAL_API_KEY })],
        }),
      ],
      controllers: [TenantConfigController],
      providers: [
        {
          provide: TenantConfigService,
          useValue: tenantConfigService,
        },
        // The real app-wide gateway guards, with the Unkey side channel stubbed:
        // key-1 is a known gateway key, any other key id is unknown (401).
        {
          provide: PermissionsSideChannelService,
          useValue: {
            resolveSlugs: async (keyId: string) => {
              if (keyId !== 'key-1') {
                throw new UnauthorizedException('gateway_key_not_found');
              }
              return ['norse-api.invoke'];
            },
          },
        },
        {
          provide: APP_GUARD,
          useFactory: (reflector: Reflector) =>
            new GatewayIdentityGuard(reflector),
          inject: [Reflector],
        },
        {
          provide: APP_GUARD,
          useFactory: (
            reflector: Reflector,
            service: PermissionsSideChannelService,
          ) => new GatewayPermissionsGuard(reflector, service),
          inject: [Reflector, PermissionsSideChannelService],
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.enableVersioning(apiVersioningOptions);
    const document = SwaggerModule.createDocument(app, buildSwaggerConfig());
    SwaggerModule.setup('swagger', app, document, {
      jsonDocumentUrl: 'swagger/json',
    });
    await app.init();
  });

  afterEach(() => app.close());

  describe('GET /tenant-config/:tenantId/topics', () => {
    it('returns topics configuration with a valid internal API key', async () => {
      const response = await request(app.getHttpServer())
        .get('/tenant-config/tenant-1/topics')
        .set('x-internal-api-key', INTERNAL_API_KEY)
        .expect(200);

      expect(response.body.tenantId).toBe('tenant-1');
      expect(response.body.list).toHaveLength(1);
      expect(tenantConfigService.getTopics).toHaveBeenCalledWith('tenant-1');
    });

    it('rejects requests without an internal API key', async () => {
      await request(app.getHttpServer())
        .get('/tenant-config/tenant-1/topics')
        .expect(401);
    });
  });

  describe('GET /tenant-config/:tenantId/suggestions', () => {
    it('returns suggestions configuration with a valid internal API key', async () => {
      const response = await request(app.getHttpServer())
        .get('/tenant-config/tenant-1/suggestions')
        .set('x-internal-api-key', INTERNAL_API_KEY)
        .expect(200);

      expect(response.body.tenantId).toBe('tenant-1');
      expect(response.body.suggestions).toHaveLength(1);
      expect(tenantConfigService.getSuggestions).toHaveBeenCalledWith(
        'tenant-1',
      );
    });

    it('rejects requests with an invalid internal API key', async () => {
      await request(app.getHttpServer())
        .get('/tenant-config/tenant-1/suggestions')
        .set('x-internal-api-key', 'wrong-key')
        .expect(401);
    });
  });

  describe('GET /tenant-config/:tenantId', () => {
    it('returns the full tenant config aggregate', async () => {
      const response = await request(app.getHttpServer())
        .get('/tenant-config/tenant-1')
        .set('x-internal-api-key', INTERNAL_API_KEY)
        .expect(200);

      expect(response.body).toEqual({
        locales: ['en', 'es'],
        facets: [
          { facet: 'age_groups', name: 'Age Groups', es: 'Grupos de edad' },
        ],
        topics: {
          tenantId: 'tenant-1',
          iconSize: 'medium',
          imageBorderRadius: '8px',
          backTexts: { en: 'Back' },
          customHeadings: { en: 'Help' },
          list: [
            {
              id: 'topic-1',
              name: 'Housing',
              names: { en: 'Housing', es: 'Vivienda' },
              subtopics: [
                {
                  id: 'sub-1',
                  name: 'Emergency Shelter',
                  names: { en: 'Emergency Shelter' },
                },
              ],
            },
          ],
        },
        suggestions: {
          tenantId: 'tenant-1',
          suggestions: [
            {
              id: 'suggestion-1',
              taxonomies: 'BD-1800',
              value: 'Emergency Shelter',
              values: { en: 'Emergency Shelter', es: 'Refugio de Emergencia' },
            },
          ],
        },
        hybridSearchConfig: {
          pinned_resources_mode: 'boost',
          enable_organization_search: true,
        },
        orchestrationConfig: {
          tenantId: 'tenant-1',
          schemas: [],
        },
      });
    });

    it('does not shadow the topics/suggestions sub-routes', async () => {
      await request(app.getHttpServer())
        .get('/tenant-config/tenant-1/topics')
        .set('x-internal-api-key', INTERNAL_API_KEY)
        .expect(200);

      await request(app.getHttpServer())
        .get('/tenant-config/tenant-1/suggestions')
        .set('x-internal-api-key', INTERNAL_API_KEY)
        .expect(200);
    });
  });

  describe.each([
    ['/tenant-config/tenant-1', 'getTenantLocales'],
    ['/tenant-config/tenant-1/topics', 'getTopics'],
    ['/tenant-config/tenant-1/suggestions', 'getSuggestions'],
  ] as const)('internal API key on GET %s', (path, serviceMethod) => {
    it('returns 401 without a key and never reaches the service', async () => {
      await request(app.getHttpServer()).get(path).expect(401);
      expect(tenantConfigService[serviceMethod]).not.toHaveBeenCalled();
    });

    it('returns 401 with a wrong key and never reaches the service', async () => {
      await request(app.getHttpServer())
        .get(path)
        .set('x-internal-api-key', `${INTERNAL_API_KEY}-wrong`)
        .expect(401);
      expect(tenantConfigService[serviceMethod]).not.toHaveBeenCalled();
    });

    it('returns 200 with the right key', async () => {
      await request(app.getHttpServer())
        .get(path)
        .set('x-internal-api-key', INTERNAL_API_KEY)
        .expect(200);
      expect(tenantConfigService[serviceMethod]).toHaveBeenCalledWith(
        'tenant-1',
      );
    });

    it('returns 200 for a gateway-authenticated identity without the internal key', async () => {
      await request(app.getHttpServer())
        .get(path)
        .set('x-connect211-identity-external-id', 'tenant-1')
        .set('x-connect211-key-id', 'key-1')
        .expect(200);
      expect(tenantConfigService[serviceMethod]).toHaveBeenCalledWith(
        'tenant-1',
      );
    });

    it('returns 401 for forged gateway headers with an unknown key id', async () => {
      // A direct host (api.c211.io) has no Envoy to strip forged headers.
      // The permissions side channel rejects the unknown key id.
      await request(app.getHttpServer())
        .get(path)
        .set('x-connect211-identity-external-id', 'tenant-1')
        .set('x-connect211-key-id', 'forged-key')
        .expect(401);
      expect(tenantConfigService[serviceMethod]).not.toHaveBeenCalled();
    });

    it('returns 401 for an incomplete gateway identity (one header)', async () => {
      await request(app.getHttpServer())
        .get(path)
        .set('x-connect211-key-id', 'key-1')
        .expect(401);
      expect(tenantConfigService[serviceMethod]).not.toHaveBeenCalled();
    });
  });

  describe('OpenAPI document', () => {
    it('marks every tenant-config operation with the internal key requirement', async () => {
      const res = await request(app.getHttpServer())
        .get('/swagger/json')
        .expect(200);

      for (const path of [
        '/tenant-config/{tenantId}',
        '/tenant-config/{tenantId}/topics',
        '/tenant-config/{tenantId}/suggestions',
      ]) {
        expect(res.body.paths[path].get.security).toContainEqual({
          'x-internal-api-key': [],
        });
      }
    });

    it('publishes the tenant-config endpoints', async () => {
      const res = await request(app.getHttpServer())
        .get('/swagger/json')
        .expect(200);

      const paths = Object.keys(res.body.paths);
      expect(paths).toContain('/tenant-config/{tenantId}');
      expect(paths).toContain('/tenant-config/{tenantId}/topics');
      expect(paths).toContain('/tenant-config/{tenantId}/suggestions');
      expect(JSON.stringify(res.body)).toContain('Tenant Config');
    });
  });
});

describe('TenantConfigController with INTERNAL_API_KEY unset', () => {
  it('fails closed on every tenant-config route', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ internalApiKey: '' })],
        }),
      ],
      controllers: [TenantConfigController],
      providers: [{ provide: TenantConfigService, useValue: {} }],
    }).compile();
    const app = moduleRef.createNestApplication();
    app.enableVersioning(apiVersioningOptions);
    await app.init();

    try {
      for (const path of [
        '/tenant-config/tenant-1',
        '/tenant-config/tenant-1/topics',
        '/tenant-config/tenant-1/suggestions',
      ]) {
        await request(app.getHttpServer()).get(path).expect(401);
        await request(app.getHttpServer())
          .get(path)
          .set('x-internal-api-key', 'anything')
          .expect(401);
      }
    } finally {
      await app.close();
    }
  });
});

describe('Other CmsConfigModule routes are unaffected', () => {
  let app: INestApplication;
  const orchestrationConfigService = {
    getCustomAttributesBySchemaNameAsCsv: jest
      .fn()
      .mockResolvedValue('source_table,source_column\n'),
    clearCache: jest.fn(),
    clearCacheForTenant: jest.fn(),
  };
  const tenantConfigService = {
    clearCache: jest.fn(),
    clearCacheForTenant: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ internalApiKey: INTERNAL_API_KEY })],
        }),
      ],
      controllers: [
        OrchestrationConfigController,
        CmsConfigController,
        TenantConfigController,
      ],
      providers: [
        {
          provide: OrchestrationConfigService,
          useValue: orchestrationConfigService,
        },
        { provide: TenantConfigService, useValue: tenantConfigService },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.enableVersioning(apiVersioningOptions);
    await app.init();
  });

  afterEach(() => app.close());

  it('serves GET /orchestration-config/custom-attributes with the key, 401 without', async () => {
    await request(app.getHttpServer())
      .get('/orchestration-config/custom-attributes')
      .set('x-internal-api-key', INTERNAL_API_KEY)
      .expect(200)
      .expect('Content-Type', /text\/csv/);
    await request(app.getHttpServer())
      .get('/orchestration-config/custom-attributes')
      .expect(401);
  });

  it('serves POST /cms-config/cache/clear/:tenantId with the key, 401 without', async () => {
    await request(app.getHttpServer())
      .post('/cms-config/cache/clear/tenant-1')
      .set('x-internal-api-key', INTERNAL_API_KEY)
      .expect(204);
    expect(tenantConfigService.clearCacheForTenant).toHaveBeenCalledWith(
      'tenant-1',
    );
    await request(app.getHttpServer())
      .post('/cms-config/cache/clear/tenant-1')
      .expect(401);
  });
});
