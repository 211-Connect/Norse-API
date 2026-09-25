import {
  Controller,
  Get,
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SwaggerModule } from '@nestjs/swagger';
import { ConfigModule } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { buildSwaggerConfig } from 'src/common/swagger/swagger-config';
import { ServiceSearchInternalModule } from './service-search.module';

/** A published route, so an empty document cannot pass the exclusion check. */
@ApiTags('Control')
@Controller('published-control')
class PublishedControlController {
  @Get()
  ping() {
    return 'ok';
  }
}

describe('ServiceSearchController (internal/services)', () => {
  let app: INestApplication;
  const search = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        ServiceSearchInternalModule,
      ],
      controllers: [PublishedControlController],
    })
      .overrideProvider(ElasticsearchService)
      .useValue({ search })
      .compile();

    app = moduleRef.createNestApplication();
    // As main.ts configures them.
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: false,
        forbidNonWhitelisted: false,
      }),
    );
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

  afterAll(() => app.close());

  beforeEach(() => {
    search.mockReset();
    search.mockResolvedValue({ hits: { total: { value: 0 }, hits: [] } });
  });

  it('serves the internal routes (so their absence from the document is meaningful)', async () => {
    await request(app.getHttpServer())
      .post('/internal/services/facets')
      .set('x-api-version', '1')
      .send({ resourceWriterIds: [] })
      .expect(200);
  });

  describe('published OpenAPI document', () => {
    it('lists published routes but not the internal services routes', async () => {
      const res = await request(app.getHttpServer())
        .get('/swagger/json')
        .expect(200);
      const paths = Object.keys(res.body.paths);
      expect(paths).toContain('/published-control');
      expect(paths.filter((p) => p.includes('internal/services'))).toEqual([]);
      expect(JSON.stringify(res.body)).not.toMatch(
        /ServicesSearch|ServicesFacets|ServiceListItem/,
      );
    });
  });

  describe('POST /internal/services/search', () => {
    it('serves a page for a valid request', async () => {
      const res = await request(app.getHttpServer())
        .post('/internal/services/search')
        .set('x-api-version', '1')
        .send({
          resourceWriterIds: ['writer-a'],
          filter: { statuses: ['active'] },
          limit: 10,
        })
        .expect(200);
      expect(res.body).toEqual({
        items: [],
        total: 0,
        limit: 10,
        nextCursor: null,
      });
      expect(search).toHaveBeenCalledTimes(1);
    });

    it.each([
      [{}],
      [{ resourceWriterIds: 'writer-a' }],
      [{ resourceWriterIds: [1] }],
      [{ resourceWriterIds: ['w'], limit: 201 }],
      [{ resourceWriterIds: ['w'], cursor: 'x'.repeat(2049) }],
      [{ resourceWriterIds: ['w'], cursor: 'not-a-cursor' }],
      [{ resourceWriterIds: ['w'], filter: { statuses: 'active' } }],
    ])('rejects %j with 400', async (body) => {
      await request(app.getHttpServer())
        .post('/internal/services/search')
        .set('x-api-version', '1')
        .send(body)
        .expect(400);
      expect(search).not.toHaveBeenCalled();
    });
  });

  describe('POST /internal/services/facets', () => {
    it('requires a writer set', async () => {
      await request(app.getHttpServer())
        .post('/internal/services/facets')
        .set('x-api-version', '1')
        .send({})
        .expect(400);
    });

    it('serves facets for a writer set', async () => {
      search.mockResolvedValue({ aggregations: {} });
      const res = await request(app.getHttpServer())
        .post('/internal/services/facets')
        .set('x-api-version', '1')
        .send({ resourceWriterIds: ['writer-a'] })
        .expect(200);
      expect(res.body).toEqual({
        contributors: [],
        statuses: [],
        taxonomy: [],
      });
    });
  });
});
