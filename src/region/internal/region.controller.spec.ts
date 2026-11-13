import {
  Controller,
  Get,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, SwaggerModule } from '@nestjs/swagger';
import { ConfigModule } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { buildSwaggerConfig } from 'src/common/swagger/swagger-config';
import { RegionInternalModule } from './region.module';
import { apiVersioningOptions } from 'src/common/versioning/api-version';

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

describe('RegionController (internal/regions)', () => {
  let app: INestApplication;
  const search = jest.fn();
  const empty = { hits: { hits: [] } };
  const lastRequest = () => search.mock.calls[search.mock.calls.length - 1][0];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ internalApiKey: INTERNAL_API_KEY })],
        }),
        RegionInternalModule,
      ],
      controllers: [PublishedControlController],
    })
      .overrideProvider(ElasticsearchService)
      .useValue({ search })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: false,
        forbidNonWhitelisted: false,
      }),
    );
    app.enableVersioning(apiVersioningOptions);
    const document = SwaggerModule.createDocument(app, buildSwaggerConfig());
    SwaggerModule.setup('swagger', app, document, {
      jsonDocumentUrl: 'swagger/json',
    });
    await app.init();
  });

  afterAll(() => app.close());

  beforeEach(() => {
    search.mockReset();
    search.mockResolvedValue(empty);
  });

  const get = (path: string) =>
    request(app.getHttpServer())
      .get(path)
      .set('x-api-version', '1')
      .set('x-internal-api-key', INTERNAL_API_KEY);

  it('serves the internal routes (so their absence from the document is meaningful)', async () => {
    await get('/internal/regions?q=jack').expect(200);
  });

  describe('published OpenAPI document', () => {
    it('lists published routes but not the internal region routes', async () => {
      const res = await request(app.getHttpServer())
        .get('/swagger/json')
        .expect(200);
      const paths = Object.keys(res.body.paths);
      expect(paths).toContain('/published-control');
      expect(paths.filter((p) => p.includes('regions'))).toEqual([]);
      expect(JSON.stringify(res.body)).not.toMatch(
        /RegionSummary|RegionSearch|RegionDetail|RegionAttribution|RegionIdParam/,
      );
    });
  });

  describe('GET /internal/regions', () => {
    it('parses types, states and limit from the query string', async () => {
      const res = await get(
        '/internal/regions?q=jack&types=state,county&states=mo,KS&limit=25',
      ).expect(200);
      expect(res.body).toEqual({ items: [] });
      const req = lastRequest();
      expect(req.size).toBe(25);
      expect(req.query.bool.filter).toEqual([
        { terms: { type: ['state', 'county'] } },
      ]);
      expect(req.query.bool.should).toContainEqual({
        constant_score: {
          filter: { terms: { state: ['MO', 'KS'] } },
          boost: 4,
        },
      });
    });

    it('accepts repeated types params', async () => {
      await get('/internal/regions?q=jack&types=state&types=zip').expect(200);
      expect(lastRequest().query.bool.filter).toEqual([
        { terms: { type: ['state', 'zip'] } },
      ]);
    });

    it.each([
      ['no q', ''],
      ['empty q', 'q='],
      ['blank q', 'q=%20%20'],
      ['limit over the cap', 'q=jack&limit=26'],
      ['limit zero', 'q=jack&limit=0'],
      ['limit not a number', 'q=jack&limit=ten'],
      ['unknown type', 'q=jack&types=city'],
      ['empty types', 'q=jack&types='],
      ['bad state code', 'q=jack&states=MOO'],
      ['q too long', `q=${'a'.repeat(101)}`],
    ])('rejects %s with 400', async (_label, qs) => {
      await get(`/internal/regions?${qs}`).expect(400);
      expect(search).not.toHaveBeenCalled();
    });
  });

  describe('Place Regions', () => {
    const place = {
      id: 'place:5367000', name: 'Spokane', state: 'WA',
      slug: 'spokane-wa', place_type: 'city', fips: '5367000', lsad: '25',
      centroid: [-117.4, 47.6],
      geometry: { type: 'MultiPolygon', coordinates: [
        [[[-117.6, 47.5], [-117.3, 47.5], [-117.3, 47.7], [-117.6, 47.5]]],
        [[[-117.2, 47.8], [-117.1, 47.8], [-117.1, 47.9], [-117.2, 47.8]]],
      ] },
    };

    it('lists summaries, filters by state and pages after the last returned Place', async () => {
      search.mockResolvedValueOnce({ hits: { hits: [
        { _source: place },
        { _source: { ...place, id: 'place:5367001', slug: 'spokane-wa-5367001' } },
      ] } });
      const first = await get('/internal/regions/places?state=WA&limit=1').expect(200);
      expect(first.body.items).toEqual([{
        id: place.id, name: place.name, state: 'WA', slug: place.slug, place_type: 'city',
      }]);
      expect(first.body.next_cursor).toEqual(expect.any(String));
      expect(lastRequest().query.bool.filter).toEqual([
        { term: { type: 'place' } }, { term: { state: 'WA' } },
      ]);
      const next = await get(`/internal/regions/places?state=WA&limit=1&cursor=${first.body.next_cursor}`).expect(200);
      expect(next.body).toEqual({ items: [], next_cursor: null });
      expect(lastRequest().search_after).toEqual(['spokane-wa', 'place:5367000']);
      await get(`/internal/regions/places?state=OR&cursor=${first.body.next_cursor}`).expect(400);
    });

    it('resolves a slug exactly and derives a bbox from all geometry parts', async () => {
      search.mockResolvedValueOnce({ hits: { hits: [{ _source: place }] } });
      const response = await get('/internal/regions/places/spokane-wa').expect(200);
      expect(response.body).toEqual({
        id: place.id, type: 'place', name: 'Spokane', state: 'WA',
        slug: 'spokane-wa', place_type: 'city', fips: '5367000', lsad: '25',
        centroid: { lng: -117.4, lat: 47.6 },
        bbox: [-117.6, 47.5, -117.1, 47.9], geometry: place.geometry,
      });
      expect(lastRequest().query.bool.filter).toEqual([
        { term: { type: 'place' } }, { term: { slug: 'spokane-wa' } },
      ]);
      await get('/internal/regions/places/missing-wa').expect(404);
      await get('/internal/regions/places/Bad_slug').expect(400);
    });

    it('requires the internal key and excludes Places from existing typeahead', async () => {
      await request(app.getHttpServer()).get('/internal/regions/places').set('x-api-version', '1').expect(401);
      await get('/internal/regions?q=spokane').expect(200);
      expect(lastRequest().query.bool.filter).toEqual([
        { terms: { type: ['state', 'county', 'zip'] } },
      ]);
    });
  });

  describe('GET /internal/regions/:id', () => {
    it.each(['state:MO', 'county:29095', 'zip:64130', 'county%3A29095'])(
      'accepts well-formed id %s and 404s when ES has no such Region',
      async (id) => {
        await get(`/internal/regions/${id}`).expect(404);
        expect(search).toHaveBeenCalledTimes(1);
      },
    );

    it('returns the Region with geometry', async () => {
      search.mockResolvedValue({
        hits: {
          hits: [
            {
              _source: {
                id: 'state:MO',
                type: 'state',
                name: 'Missouri',
                state: 'MO',
                fips: null,
                zip: null,
                geometry: { type: 'MultiPolygon', coordinates: [] },
              },
            },
          ],
        },
      });
      const res = await get('/internal/regions/state:MO').expect(200);
      expect(res.body).toEqual({
        id: 'state:MO',
        type: 'state',
        name: 'Missouri',
        state: 'MO',
        geometry: { type: 'MultiPolygon', coordinates: [] },
      });
    });

    it.each([
      'state:mo',
      'state:MOO',
      'county:2909',
      'county:290955',
      'county:MO',
      'zip:6413',
      'zip:64130-1234',
      'city:kansas',
      'MO',
    ])('rejects malformed id %s with 400 without calling ES', async (id) => {
      await get(`/internal/regions/${id}`).expect(400);
      expect(search).not.toHaveBeenCalled();
    });
  });
});
