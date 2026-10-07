import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { TenantConfigController } from './tenant-config.controller';
import { TenantConfigService } from './tenant-config.service';
import { buildSwaggerConfig } from '../common/swagger/swagger-config';

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
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.enableVersioning({
      type: VersioningType.HEADER,
      header: 'x-api-version',
      defaultVersion: '1',
    });
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

  describe('OpenAPI document', () => {
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
