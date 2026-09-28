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

const INTERNAL_API_KEY = 'internal-key-for-tests';

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
  const mget = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ internalApiKey: INTERNAL_API_KEY })],
        }),
        ServiceSearchInternalModule,
      ],
      controllers: [PublishedControlController],
    })
      .overrideProvider(ElasticsearchService)
      .useValue({ search, mget })
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
    mget.mockReset();
    mget.mockImplementation(async ({ ids }: { ids: string[] }) => ({
      docs: ids.map((_id) => ({ _id, found: true })),
    }));
  });

  it('serves the internal routes (so their absence from the document is meaningful)', async () => {
    await request(app.getHttpServer())
      .post('/internal/services/facets')
      .set('x-api-version', '1')
      .set('x-internal-api-key', INTERNAL_API_KEY)
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
        /ServicesSearch|ServicesFacets|ServicesScopeFilter|ServicesGeography|ServiceListItem|ServicesExclusion|ServicesAppliedExclusions/,
      );
    });
  });

  describe('POST /internal/services/search', () => {
    it('serves a page for a valid request', async () => {
      const res = await request(app.getHttpServer())
        .post('/internal/services/search')
        .set('x-api-version', '1')
        .set('x-internal-api-key', INTERNAL_API_KEY)
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
        appliedExclusions: { serviceIds: [], taxonomyCodes: [], regionIds: [] },
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
      [{ resourceWriterIds: ['w'], filter: { geography: {} } }],
      [{ resourceWriterIds: ['w'], filter: { geography: { regionIds: [] } } }],
      [
        {
          resourceWriterIds: ['w'],
          filter: { geography: { regionIds: ['county:29510', 'St. Louis'] } },
        },
      ],
      [
        {
          resourceWriterIds: ['w'],
          filter: { geography: { regionIds: ['state:mo'] } },
        },
      ],
      [
        {
          resourceWriterIds: ['w'],
          filter: {
            geography: {
              regionIds: Array.from(
                { length: 21 },
                (_, i) => `zip:${String(63100 + i)}`,
              ),
            },
          },
        },
      ],
      [{ resourceWriterIds: ['w'], filter: { virtual: 'yes' } }],
      [{ resourceWriterIds: ['w'], exclude: 's1' }],
      [{ resourceWriterIds: ['w'], exclude: { serviceIds: 's1' } }],
      [{ resourceWriterIds: ['w'], exclude: { serviceIds: [1] } }],
      [{ resourceWriterIds: ['w'], exclude: { taxonomyCodes: 'BD' } }],
      [{ resourceWriterIds: ['w'], exclude: { regionIds: ['St. Louis'] } }],
      [
        {
          resourceWriterIds: ['w'],
          exclude: {
            serviceIds: Array.from({ length: 1001 }, (_, i) => `s${i}`),
          },
        },
      ],
      [
        {
          resourceWriterIds: ['w'],
          exclude: {
            regionIds: Array.from({ length: 21 }, (_, i) => `zip:${63100 + i}`),
          },
        },
      ],
      [{ resourceWriterIds: ['w'], filter: { match: 'near' } }],
      [
        {
          resourceWriterIds: ['w'],
          filter: { geography: { regionIds: [], points: [] } },
        },
      ],
      ...[
        { lat: 91, lng: -78.9, radiusMiles: 10 },
        { lat: 35.9, lng: -181, radiusMiles: 10 },
        { lat: 35.9, lng: -78.9, radiusMiles: 0 },
        { lat: 35.9, lng: -78.9, radiusMiles: 100.5 },
        { lat: 35.9, radiusMiles: 10 },
        { lat: '35.9', lng: -78.9, radiusMiles: 10 },
      ].map((point) => [
        {
          resourceWriterIds: ['w'],
          filter: { geography: { points: [point] } },
        },
      ]),
      [
        {
          resourceWriterIds: ['w'],
          filter: {
            geography: {
              regionIds: Array.from(
                { length: 10 },
                (_, i) => `zip:${String(63100 + i)}`,
              ),
              points: Array.from({ length: 11 }, (_, i) => ({
                lat: 35 + i / 100,
                lng: -78.9,
                radiusMiles: 10,
              })),
            },
          },
        },
      ],
    ])('rejects %j with 400', async (body) => {
      await request(app.getHttpServer())
        .post('/internal/services/search')
        .set('x-api-version', '1')
        .set('x-internal-api-key', INTERNAL_API_KEY)
        .send(body)
        .expect(400);
      expect(search).not.toHaveBeenCalled();
      expect(mget).not.toHaveBeenCalled();
    });

    it('accepts exclusions and confirms them in the response', async () => {
      const exclude = {
        serviceIds: Array.from({ length: 1000 }, (_, i) => `s${i}`),
        taxonomyCodes: ['BD-1800'],
        regionIds: ['county:29510'],
      };
      const res = await request(app.getHttpServer())
        .post('/internal/services/search')
        .set('x-api-version', '1')
        .set('x-internal-api-key', INTERNAL_API_KEY)
        .send({ resourceWriterIds: ['writer-a'], exclude })
        .expect(200);
      expect(res.body.appliedExclusions).toEqual(exclude);
      expect(search.mock.calls[0][0].query.bool.must_not).toHaveLength(5);
    });

    it('accepts 20 Regions and a virtual mode', async () => {
      await request(app.getHttpServer())
        .post('/internal/services/search')
        .set('x-api-version', '1')
        .set('x-internal-api-key', INTERNAL_API_KEY)
        .send({
          resourceWriterIds: ['writer-a'],
          filter: {
            geography: {
              regionIds: Array.from(
                { length: 20 },
                (_, i) => `zip:${63100 + i}`,
              ),
            },
            virtual: 'exclude',
          },
        })
        .expect(200);
      expect(search).toHaveBeenCalledTimes(1);
    });

    it('accepts 20 Places of Regions and points together', async () => {
      await request(app.getHttpServer())
        .post('/internal/services/search')
        .set('x-api-version', '1')
        .set('x-internal-api-key', INTERNAL_API_KEY)
        .send({
          resourceWriterIds: ['writer-a'],
          filter: {
            geography: {
              regionIds: Array.from(
                { length: 10 },
                (_, i) => `zip:${63100 + i}`,
              ),
              points: Array.from({ length: 10 }, (_, i) => ({
                lat: 35 + i / 100,
                lng: -78.9,
                radiusMiles: 0.1 + i * 10,
              })),
            },
          },
        })
        .expect(200);
      expect(search).toHaveBeenCalledTimes(1);
    });

    it('answers an unknown Region with 400 listing it', async () => {
      mget.mockResolvedValueOnce({
        docs: [{ _id: 'zip:00000', found: false }],
      });
      const res = await request(app.getHttpServer())
        .post('/internal/services/search')
        .set('x-api-version', '1')
        .set('x-internal-api-key', INTERNAL_API_KEY)
        .send({
          resourceWriterIds: ['writer-a'],
          filter: { geography: { regionIds: ['zip:00000'] } },
        })
        .expect(400);
      expect(JSON.stringify(res.body)).toContain('zip:00000');
      expect(search).not.toHaveBeenCalled();
    });
  });

  describe('POST /internal/services/facets', () => {
    it('requires a writer set', async () => {
      await request(app.getHttpServer())
        .post('/internal/services/facets')
        .set('x-api-version', '1')
        .set('x-internal-api-key', INTERNAL_API_KEY)
        .send({})
        .expect(400);
    });

    it.each([
      [{ geography: { regionIds: ['nowhere'] } }],
      [{ virtual: 'maybe' }],
    ])('rejects filter %j with 400', async (filter) => {
      await request(app.getHttpServer())
        .post('/internal/services/facets')
        .set('x-api-version', '1')
        .set('x-internal-api-key', INTERNAL_API_KEY)
        .send({ resourceWriterIds: ['writer-a'], filter })
        .expect(400);
      expect(search).not.toHaveBeenCalled();
    });

    it('rejects an unusable exclude with 400', async () => {
      await request(app.getHttpServer())
        .post('/internal/services/facets')
        .set('x-api-version', '1')
        .set('x-internal-api-key', INTERNAL_API_KEY)
        .send({
          resourceWriterIds: ['writer-a'],
          exclude: { regionIds: ['x'] },
        })
        .expect(400);
      expect(search).not.toHaveBeenCalled();
    });

    it('confirms exclusions on facets', async () => {
      search.mockResolvedValue({ aggregations: {} });
      const res = await request(app.getHttpServer())
        .post('/internal/services/facets')
        .set('x-api-version', '1')
        .set('x-internal-api-key', INTERNAL_API_KEY)
        .send({
          resourceWriterIds: ['writer-a'],
          exclude: { serviceIds: ['s1'] },
        })
        .expect(200);
      expect(res.body.appliedExclusions).toEqual({
        serviceIds: ['s1'],
        taxonomyCodes: [],
        regionIds: [],
      });
    });

    it('serves facets for a writer set', async () => {
      search.mockResolvedValue({ aggregations: {} });
      const res = await request(app.getHttpServer())
        .post('/internal/services/facets')
        .set('x-api-version', '1')
        .set('x-internal-api-key', INTERNAL_API_KEY)
        .send({ resourceWriterIds: ['writer-a'] })
        .expect(200);
      expect(res.body).toEqual({
        contributors: [],
        statuses: [],
        taxonomy: [],
        appliedExclusions: { serviceIds: [], taxonomyCodes: [], regionIds: [] },
      });
    });
  });
});
