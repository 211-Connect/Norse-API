import {
  Body,
  Controller,
  Get,
  HttpCode,
  INestApplication,
  Post,
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
import {
  INTERNAL_SERVICES_BODY_LIMIT_BYTES,
  useInternalServicesBodyLimit,
} from './internal-services-body';
import { getModelToken } from '@nestjs/mongoose';
import {
  SharingWithheldService,
  SharingWithheldVersion,
} from 'src/common/schemas/sharing-withholding.schema';
import {
  SERVICES_EXCLUDE_MAX_REGIONS,
  SERVICES_EXCLUDE_MAX_RULES,
  SERVICES_EXCLUDE_MAX_TAXONOMY_CODES,
  SERVICES_EXCLUDE_MAX_WITHHOLDINGS,
} from './dto';
import {
  taxonomyTerm,
  taxonomyTermsIndex,
} from 'src/common/testing/taxonomy-terms-index';

/** More than the provisional 1,000 serviceIds cap ISS-1938 removed. */
const MANY_SERVICE_IDS = 1500;

function mongoQuery(result: unknown) {
  const query = {
    read: () => query,
    lean: () => query,
    exec: async () => result,
  };
  return query;
}

const INTERNAL_API_KEY = 'internal-key-for-tests';

/** A published route, so an empty document cannot pass the exclusion check. */
@ApiTags('Control')
@Controller('published-control')
class PublishedControlController {
  @Get()
  ping() {
    return 'ok';
  }

  @Post()
  @HttpCode(200)
  echo(@Body() body: unknown) {
    return body;
  }
}

describe('ServiceSearchController (internal/services)', () => {
  let app: INestApplication;
  const search = jest.fn();
  const mget = jest.fn();
  const withheldFind = jest.fn();
  const versionFindOne = jest.fn();

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
      .overrideProvider(getModelToken(SharingWithheldService.name))
      .useValue({ find: withheldFind })
      .overrideProvider(getModelToken(SharingWithheldVersion.name))
      .useValue({ findOne: versionFindOne })
      .compile();

    app = moduleRef.createNestApplication();
    // As main.ts configures them.
    useInternalServicesBodyLimit(app);
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
    withheldFind.mockReset();
    versionFindOne.mockReset();
  });

  it('serves the internal routes (so their absence from the document is meaningful)', async () => {
    await request(app.getHttpServer())
      .post('/internal/services/facets')
      .set('x-api-version', '1')
      .set('x-internal-api-key', INTERNAL_API_KEY)
      .send({ resourceWriterIds: [] })
      .expect(200);
  });

  describe('request body limit', () => {
    /** 36-character ids serialise to 39 bytes each: quotes and a comma. */
    const idsOfBytes = (bytes: number) =>
      Array.from({ length: Math.ceil(bytes / 39) }, (_, i) =>
        String(i).padStart(36, '0'),
      );
    const post = (path: string, body: object) =>
      request(app.getHttpServer())
        .post(path)
        .set('x-api-version', '1')
        .set('x-internal-api-key', INTERNAL_API_KEY)
        .send(body);

    it.each(['search', 'facets'])(
      'accepts a %s body well past the default 100 kB',
      async (route) => {
        const serviceIds = idsOfBytes(4 * 1024 * 1024);
        const res = await post(`/internal/services/${route}`, {
          resourceWriterIds: ['writer-a'],
          exclude: { serviceIds },
        }).expect(200);
        expect(res.body.appliedExclusions.serviceIds).toHaveLength(
          serviceIds.length,
        );
      },
    );

    it('answers 413 with the limit stated beyond it', async () => {
      const body = {
        resourceWriterIds: ['writer-a'],
        exclude: {
          serviceIds: idsOfBytes(INTERNAL_SERVICES_BODY_LIMIT_BYTES + 1024),
        },
      };
      expect(JSON.stringify(body).length).toBeGreaterThan(
        INTERNAL_SERVICES_BODY_LIMIT_BYTES,
      );
      const res = await post('/internal/services/search', body).expect(413);
      expect(res.body).toMatchObject({ statusCode: 413 });
      expect(res.body.message).toContain('5 MB');
      expect(search).not.toHaveBeenCalled();
    });

    it('leaves the default limit, and JSON parsing, on every other route', async () => {
      const small = await post('/published-control', { a: 1 }).expect(200);
      expect(small.body).toEqual({ a: 1 });
      await post('/published-control', {
        serviceIds: idsOfBytes(200 * 1024),
      }).expect(413);
    });
  });

  describe('published OpenAPI document', () => {
    it('lists published routes but not the internal services routes', async () => {
      const res = await request(app.getHttpServer())
        .get('/swagger/json')
        .expect(200);
      const paths = Object.keys(res.body.paths);
      expect(paths).toContain('/published-control');
      expect(paths.filter((p) => p.includes('internal/services'))).toEqual([]);
      expect(paths.filter((p) => p.includes('taxonomy-names'))).toEqual([]);
      expect(JSON.stringify(res.body)).not.toMatch(
        /ServicesSearch|ServicesFacets|ServicesScopeFilter|ServicesGeography|ServiceListItem|ServicesExclusion|ServicesAppliedExclusion|TaxonomyNames/,
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
        appliedExclusions: { serviceIds: [], rules: [], withholdings: [] },
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
      [
        {
          resourceWriterIds: ['w'],
          exclude: { serviceIds: ['s'.repeat(129)] },
        },
      ],
      [{ resourceWriterIds: ['w'], exclude: { rules: { statuses: ['a'] } } }],
      [{ resourceWriterIds: ['w'], exclude: { rules: [{}] } }],
      [{ resourceWriterIds: ['w'], exclude: { rules: [{ statuses: [] }] } }],
      [{ resourceWriterIds: ['w'], exclude: { rules: [{ statuses: [1] }] } }],
      [
        {
          resourceWriterIds: ['w'],
          exclude: { rules: [{ taxonomyCodes: 'BD' }] },
        },
      ],
      [{ resourceWriterIds: ['w'], exclude: { rules: [{ virtual: 'all' }] } }],
      ...['', 7, 'w'.repeat(129)].map((ownerWriterId) => [
        {
          resourceWriterIds: ['w'],
          exclude: { rules: [{ statuses: ['active'], ownerWriterId }] },
        },
      ]),
      [
        {
          resourceWriterIds: ['w'],
          exclude: { rules: [{ regionIds: ['St. Louis'] }] },
        },
      ],
      ...[
        'x',
        [{}],
        [{ agreementId: 'a', ownerWriterId: 'w' }],
        [{ agreementId: 'a', ownerWriterId: 'w', version: 0 }],
        [{ agreementId: 'a', ownerWriterId: 'w', version: 1.5 }],
        [{ agreementId: 'a', ownerWriterId: 'w', version: '2' }],
        [{ agreementId: '', ownerWriterId: 'w', version: 1 }],
        [{ agreementId: 'a', ownerWriterId: 7, version: 1 }],
        Array.from(
          { length: SERVICES_EXCLUDE_MAX_WITHHOLDINGS + 1 },
          (_, i) => ({
            agreementId: 'a',
            ownerWriterId: `w${i}`,
            version: 1,
          }),
        ),
      ].map((withholdings) => [
        { resourceWriterIds: ['w'], exclude: { withholdings } },
      ]),
      [
        {
          resourceWriterIds: ['w'],
          exclude: {
            rules: Array.from(
              { length: SERVICES_EXCLUDE_MAX_RULES + 1 },
              (_, i) => ({ statuses: [`s${i}`] }),
            ),
          },
        },
      ],
      [
        {
          resourceWriterIds: ['w'],
          exclude: {
            rules: [
              {
                regionIds: Array.from(
                  { length: SERVICES_EXCLUDE_MAX_REGIONS + 1 },
                  (_, i) => `zip:${63100 + i}`,
                ),
              },
            ],
          },
        },
      ],
      [
        {
          resourceWriterIds: ['w'],
          exclude: {
            rules: [
              {
                taxonomyCodes: Array.from(
                  { length: SERVICES_EXCLUDE_MAX_TAXONOMY_CODES + 1 },
                  (_, i) => `BD-${i}`,
                ),
              },
            ],
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

    const regionRules = (...sizes: number[]) =>
      sizes.map((size, r) => ({
        regionIds: Array.from(
          { length: size },
          (_, i) => `zip:${63000 + 100 * r + i}`,
        ),
      }));

    it('refuses more Region ids across all rules than one rule may hold, with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/internal/services/search')
        .set('x-api-version', '1')
        .set('x-internal-api-key', INTERNAL_API_KEY)
        .send({
          resourceWriterIds: ['writer-a'],
          exclude: { rules: regionRules(11, 10) },
        })
        .expect(400);
      expect(res.body.message).toContain(
        `at most ${SERVICES_EXCLUDE_MAX_REGIONS} Region ids across all rules`,
      );
      expect(search).not.toHaveBeenCalled();
      expect(mget).not.toHaveBeenCalled();
    });

    it('accepts Region ids across rules up to the total', async () => {
      await request(app.getHttpServer())
        .post('/internal/services/facets')
        .set('x-api-version', '1')
        .set('x-internal-api-key', INTERNAL_API_KEY)
        .send({
          resourceWriterIds: ['writer-a'],
          exclude: { rules: regionRules(10, 5, 5) },
        })
        .expect(200);
    });

    it('accepts exclusions at their limits and confirms them in the response', async () => {
      const serviceIds = Array.from(
        { length: MANY_SERVICE_IDS },
        (_, i) => `s${i}`,
      );
      const rules = [
        {
          taxonomyCodes: Array.from(
            { length: SERVICES_EXCLUDE_MAX_TAXONOMY_CODES },
            (_, i) => `BD-${i}`,
          ),
          statuses: ['inactive'],
        },
        {
          regionIds: Array.from(
            { length: SERVICES_EXCLUDE_MAX_REGIONS },
            (_, i) => `zip:${63100 + i}`,
          ),
          virtual: 'only',
        },
        ...Array.from({ length: SERVICES_EXCLUDE_MAX_RULES - 2 }, (_, i) => ({
          statuses: [`status-${i}`],
        })),
      ];
      const res = await request(app.getHttpServer())
        .post('/internal/services/search')
        .set('x-api-version', '1')
        .set('x-internal-api-key', INTERNAL_API_KEY)
        .send({
          resourceWriterIds: ['writer-a'],
          exclude: { serviceIds, rules },
        })
        .expect(200);
      expect(res.body.appliedExclusions).toEqual({
        serviceIds,
        rules: rules.map((rule) => ({
          taxonomyCodes: [],
          regionIds: [],
          statuses: [],
          virtual: null,
          ownerWriterId: null,
          ...rule,
        })),
        withholdings: [],
      });
      expect(search.mock.calls[0][0].query.bool.must_not).toHaveLength(
        2 + 1 + SERVICES_EXCLUDE_MAX_RULES,
      );
    });

    it('applies a Withholding by reference and confirms its version', async () => {
      versionFindOne.mockReturnValue(
        mongoQuery({
          agreementId: 'a1',
          ownerWriterId: 'writer-a',
          version: 7,
          serviceCount: 2,
        }),
      );
      withheldFind.mockReturnValue(
        mongoQuery([{ serviceId: 's1' }, { serviceId: 's2' }]),
      );
      const res = await request(app.getHttpServer())
        .post('/internal/services/search')
        .set('x-api-version', '1')
        .set('x-internal-api-key', INTERNAL_API_KEY)
        .send({
          resourceWriterIds: ['writer-a'],
          exclude: {
            withholdings: [
              { agreementId: 'a1', ownerWriterId: 'writer-a', version: 7 },
            ],
          },
        })
        .expect(200);
      expect(res.body.appliedExclusions.withholdings).toEqual([
        {
          agreementId: 'a1',
          ownerWriterId: 'writer-a',
          version: 7,
          serviceCount: 2,
        },
      ]);
      expect(search).toHaveBeenCalledTimes(1);
    });

    it.each([
      [6, 503],
      [8, 409],
    ])(
      'answers %#: a projection at version %i for version 7 is %i, and nothing is searched',
      async (held, status) => {
        versionFindOne.mockReturnValue(
          mongoQuery({
            agreementId: `lagging-${held}`,
            ownerWriterId: 'writer-a',
            version: held,
            serviceCount: 0,
          }),
        );
        withheldFind.mockReturnValue(mongoQuery([]));
        await request(app.getHttpServer())
          .post('/internal/services/search')
          .set('x-api-version', '1')
          .set('x-internal-api-key', INTERNAL_API_KEY)
          .send({
            resourceWriterIds: ['writer-a'],
            exclude: {
              withholdings: [
                {
                  agreementId: `lagging-${held}`,
                  ownerWriterId: 'writer-a',
                  version: 7,
                },
              ],
            },
          })
          .expect(status);
        expect(search).not.toHaveBeenCalled();
      },
    );

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
          exclude: { rules: [{ regionIds: ['x'] }] },
        })
        .expect(400);
      expect(search).not.toHaveBeenCalled();
    });

    it('rejects a rule without criteria with 400', async () => {
      await request(app.getHttpServer())
        .post('/internal/services/facets')
        .set('x-api-version', '1')
        .set('x-internal-api-key', INTERNAL_API_KEY)
        .send({ resourceWriterIds: ['writer-a'], exclude: { rules: [{}] } })
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
          exclude: {
            serviceIds: ['s1'],
            rules: [
              { statuses: ['inactive'] },
              { statuses: ['closed'], ownerWriterId: 'writer-a' },
            ],
          },
        })
        .expect(200);
      expect(res.body.appliedExclusions).toEqual({
        serviceIds: ['s1'],
        rules: [
          {
            taxonomyCodes: [],
            regionIds: [],
            statuses: ['inactive'],
            virtual: null,
            ownerWriterId: null,
          },
          {
            taxonomyCodes: [],
            regionIds: [],
            statuses: ['closed'],
            virtual: null,
            ownerWriterId: 'writer-a',
          },
        ],
        withholdings: [],
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
        appliedExclusions: { serviceIds: [], rules: [], withholdings: [] },
      });
    });
  });

  describe('POST /internal/services/taxonomy-names', () => {
    const lookup = (body: object) =>
      request(app.getHttpServer())
        .post('/internal/services/taxonomy-names')
        .set('x-api-version', '1')
        .set('x-internal-api-key', INTERNAL_API_KEY)
        .send(body);

    it("answers each writer's names for the requested codes, keyed as requested", async () => {
      search.mockImplementation(
        taxonomyTermsIndex([
          taxonomyTerm('writer-a', 'BD-1800', { en: 'Emergency Food' }),
          taxonomyTerm('writer-b', 'BD-1800.', { en: 'Food Now' }),
        ]),
      );

      const res = await lookup({
        resourceWriterIds: ['writer-a', 'writer-b', 'writer-c'],
        codes: ['BD-1800.', 'BH'],
      }).expect(200);

      expect(res.body).toEqual({
        names: {
          'writer-a': { 'BD-1800.': 'Emergency Food' },
          'writer-b': { 'BD-1800.': 'Food Now' },
        },
      });
    });

    it('refuses a request without the internal key', async () => {
      await request(app.getHttpServer())
        .post('/internal/services/taxonomy-names')
        .set('x-api-version', '1')
        .send({ resourceWriterIds: ['writer-a'], codes: ['BD'] })
        .expect(401);
      expect(search).not.toHaveBeenCalled();
    });

    const codesOf = (n: number) =>
      Array.from({ length: n }, (_, i) => `AA-${i}`);
    const writersOf = (n: number) =>
      Array.from({ length: n }, (_, i) => `writer-${i}`);

    it.each([
      ['no body', {}],
      ['no codes', { resourceWriterIds: ['writer-a'] }],
      ['no writers', { codes: ['BD'] }],
      ['an empty writer list', { resourceWriterIds: [], codes: ['BD'] }],
      ['an empty code list', { resourceWriterIds: ['writer-a'], codes: [] }],
      ['a blank writer', { resourceWriterIds: [''], codes: ['BD'] }],
      ['a non-string writer', { resourceWriterIds: [7], codes: ['BD'] }],
      ['a blank code', { resourceWriterIds: ['writer-a'], codes: [''] }],
      ['a non-string code', { resourceWriterIds: ['writer-a'], codes: [7] }],
      ['codes as a string', { resourceWriterIds: ['writer-a'], codes: 'BD' }],
      [
        'a blank locale',
        { resourceWriterIds: ['writer-a'], codes: ['BD'], locale: '' },
      ],
      [
        'a non-string locale',
        { resourceWriterIds: ['writer-a'], codes: ['BD'], locale: 1 },
      ],
      [
        '5,001 codes',
        { resourceWriterIds: ['writer-a'], codes: codesOf(5001) },
      ],
      ['101 writers', { resourceWriterIds: writersOf(101), codes: ['BD'] }],
    ])('rejects %s with 400, without searching', async (_label, body) => {
      await lookup(body).expect(400);
      expect(search).not.toHaveBeenCalled();
    });

    it('accepts 100 writers and 5,000 codes', async () => {
      search.mockImplementation(taxonomyTermsIndex([]));
      await lookup({
        resourceWriterIds: writersOf(100),
        codes: codesOf(5000),
        locale: 'es',
      })
        .expect(200)
        .expect({ names: {} });
    });
  });
});
