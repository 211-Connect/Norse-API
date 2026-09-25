import {
  Controller,
  Get,
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ApiTags, SwaggerModule } from '@nestjs/swagger';
import { ConfigModule } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { RegionInternalModule } from 'src/region/internal/region.module';
import { ServiceSearchInternalModule } from 'src/service/internal/service-search.module';
import { buildSwaggerConfig } from './swagger-config';

/** A published route, so an empty document cannot pass the exclusion check. */
@ApiTags('Control')
@Controller('published-control')
class PublishedControlController {
  @Get()
  ping() {
    return 'ok';
  }
}

/**
 * The Geography filter's internal routes (ADR 0023/0024) mounted together,
 * as AppModule mounts them: both controllers are served, neither is published.
 */
describe('Geography filter internal routes, mounted together', () => {
  let app: INestApplication;
  const search = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        ServiceSearchInternalModule,
        RegionInternalModule,
      ],
      controllers: [PublishedControlController],
    })
      .overrideProvider(ElasticsearchService)
      .useValue({ search })
      .compile();

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

  afterAll(() => app.close());

  beforeEach(() => {
    search.mockReset();
    search.mockResolvedValue({ hits: { hits: [] }, aggregations: {} });
  });

  it('serves both internal controllers (so their absence from the document is meaningful)', async () => {
    const server = app.getHttpServer();
    await request(server)
      .post('/internal/services/facets')
      .set('x-api-version', '1')
      .send({ resourceWriterIds: ['writer-a'] })
      .expect(200);
    await request(server)
      .get('/internal/regions?q=jack')
      .set('x-api-version', '1')
      .expect(200);
  });

  it('publishes none of them in the OpenAPI document', async () => {
    const res = await request(app.getHttpServer())
      .get('/swagger/json')
      .expect(200);
    const paths = Object.keys(res.body.paths);
    expect(paths).toContain('/published-control');
    expect(paths.filter((p) => p.includes('internal'))).toEqual([]);
    expect(JSON.stringify(res.body)).not.toMatch(
      /ServicesSearch|ServicesFacets|ServicesScopeFilter|ServicesGeography|ServiceListItem|RegionSummary|RegionSearch|RegionDetail|RegionAttribution|RegionIdParam/,
    );
  });
});
