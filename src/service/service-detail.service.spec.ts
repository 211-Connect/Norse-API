import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { ServiceDetailService } from './service-detail.service';
import { Service } from 'src/common/schemas/service.schema';
import { HeadersDto } from 'src/common/dto/headers.dto';

describe('ServiceDetailService', () => {
  let service: ServiceDetailService;

  const aggregateExec = jest.fn();
  // Captured rather than read back off the mock: the pipeline IS what these
  // tests inspect, and typing it here keeps every assertion below plain.
  let seenPipeline: Record<string, unknown>[] | undefined;
  // Typed to receive the pipeline, because the pipeline IS what these tests
  // inspect: `mock.calls[0][0]` is the stage array.
  const mockAggregate = jest.fn((pipeline: unknown[]) => {
    seenPipeline = pipeline as Record<string, unknown>[];
    return { exec: aggregateExec };
  });
  const mockServiceModel = { aggregate: mockAggregate };

  const tenantId = '60d98ab9-51f4-4a0d-b6f1-8753facdad43';
  const serviceId = 'e3f6e7c5-6e23-51f5-b436-2ce3a61ed86f';
  const headers = (locale = 'en'): HeadersDto => ({
    'accept-language': locale,
    'x-tenant-id': tenantId,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    seenPipeline = undefined;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceDetailService,
        { provide: getModelToken(Service.name), useValue: mockServiceModel },
      ],
    }).compile();
    service = module.get<ServiceDetailService>(ServiceDetailService);
  });

  const stageNamed = (name: string) =>
    seenPipeline?.find((stage) => name in stage);

  it('matches on tenant AND serviceId', async () => {
    aggregateExec.mockResolvedValue([{ serviceId, tenant_id: tenantId }]);
    await service.findById(serviceId, { headers: headers() });
    expect(stageNamed('$match')).toEqual({
      $match: { tenant_id: tenantId, serviceId },
    });
  });

  /**
   * The organization endpoint falls back to an unscoped lookup when the
   * tenant-scoped one misses, and will answer from ANY tenant. This endpoint
   * must not: `serviceId` is unique per writer, not across writers.
   */
  it('has no no-tenant fallback', async () => {
    aggregateExec.mockResolvedValue([]);
    await expect(
      service.findById(serviceId, { headers: headers() }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockAggregate).toHaveBeenCalledTimes(1);
  });

  /**
   * The whole point of the endpoint. Nine locales per translation-bearing
   * array is roughly half the bytes of these documents, and filtering after
   * the fetch — which is what the organization endpoint does — does not
   * reduce what crosses the wire.
   */
  it('narrows translations inside the pipeline, before transfer', async () => {
    aggregateExec.mockResolvedValue([{ serviceId, tenant_id: tenantId }]);
    await service.findById(serviceId, { headers: headers('es') });
    const addFields = stageNamed('$addFields');
    expect(addFields).toBeDefined();
    const json = JSON.stringify(addFields);
    // The requested locale, English and canonical rows are what the JS
    // selection can still choose between; everything else is dropped in Mongo.
    expect(json).toContain('"$$t.LOCALE","es"');
    expect(json).toContain('"$$t.LOCALE","en"');
    expect(json).toContain('IS_CANONICAL');
  });

  it('narrows the heavy arrays and the nested location arrays', async () => {
    aggregateExec.mockResolvedValue([{ serviceId, tenant_id: tenantId }]);
    await service.findById(serviceId, { headers: headers() });
    const json = JSON.stringify(stageNamed('$addFields'));
    for (const path of [
      'attributeTaxonomies',
      'serviceAreas',
      'schedules',
      'languages',
      'locations',
    ]) {
      expect(json).toContain(path);
    }
    // Two levels: a location's own arrays carry translations too, and one
    // MD211_V2 service spans 666 locations.
    expect(json).toContain('$$loc.SCHEDULES');
    expect(json).toContain('$$loc.LANGUAGES');
  });

  /**
   * `$mergeObjects` over a null organization would manufacture an object —
   * the `{}`-is-truthy hazard the dbt model guards against with its own CASE.
   */
  it('leaves an orphan service null rather than inventing an organization', async () => {
    aggregateExec.mockResolvedValue([{ serviceId, tenant_id: tenantId }]);
    await service.findById(serviceId, { headers: headers() });
    const json = JSON.stringify(stageNamed('$addFields'));
    expect(json).toContain('$cond');
    expect(json).toContain('missing');
  });

  /**
   * `TAXONOMY_NAME_TRANSLATIONS` is a translation array whose name is not
   * exactly `TRANSLATIONS`, and both layers originally missed it: the pipeline
   * did not name it, and the shared JS transform matched the key exactly.
   * Verified against a live document — `accept-language: en` returned `yue`,
   * `vi`, `es` and `ar` under that key while every `TRANSLATIONS` beside it
   * was correctly reduced to one English row.
   */
  it('narrows TAXONOMY_NAME_TRANSLATIONS, not only TRANSLATIONS', async () => {
    aggregateExec.mockResolvedValue([{ serviceId, tenant_id: tenantId }]);
    await service.findById(serviceId, { headers: headers() });
    expect(JSON.stringify(stageNamed('$addFields'))).toContain(
      'TAXONOMY_NAME_TRANSLATIONS',
    );
  });

  it('selects the locale for any key ending in translations', async () => {
    aggregateExec.mockResolvedValue([
      {
        serviceId,
        tenant_id: tenantId,
        attributeTaxonomies: [
          {
            CODE: 'BD-1800',
            TRANSLATIONS: [{ LOCALE: 'en', NAME: 'Food' }],
            TAXONOMY_NAME_TRANSLATIONS: [
              { LOCALE: 'en', NAME: 'Human Services' },
              { LOCALE: 'es', NAME: 'Servicios Humanos' },
              { LOCALE: 'vi', NAME: 'Dich vu' },
            ],
          },
        ],
      },
    ]);
    const result = await service.findById(serviceId, { headers: headers() });
    const taxonomies = result.attributeTaxonomies as Record<string, unknown>[];
    const names = taxonomies[0].TAXONOMY_NAME_TRANSLATIONS as Record<
      string,
      unknown
    >[];
    expect(names).toHaveLength(1);
    expect(names[0].LOCALE).toBe('en');
  });

  it('drops the Mongo _id', async () => {
    aggregateExec.mockResolvedValue([{ serviceId, tenant_id: tenantId }]);
    await service.findById(serviceId, { headers: headers() });
    expect(stageNamed('$project')).toEqual({ $project: { _id: 0 } });
  });

  /**
   * The pipeline keeps a SUPERSET; the JS transform makes the final pick. This
   * asserts the two compose — otherwise the endpoint would return English
   * alongside the requested locale.
   */
  it('returns only the selected locale after the JS pass', async () => {
    aggregateExec.mockResolvedValue([
      {
        serviceId,
        tenant_id: tenantId,
        languages: [
          {
            ID: 'l1',
            TRANSLATIONS: [
              { LOCALE: 'en', NAME: 'English', IS_CANONICAL: true },
              { LOCALE: 'es', NAME: 'Espanol' },
            ],
          },
        ],
      },
    ]);
    const result = await service.findById(serviceId, {
      headers: headers('es'),
    });
    const langs = result.languages as Record<string, unknown>[];
    const translations = langs[0].TRANSLATIONS as Record<string, unknown>[];
    expect(translations).toHaveLength(1);
    expect(translations[0].LOCALE).toBe('es');
  });

  it('falls back to English when the requested locale is absent', async () => {
    aggregateExec.mockResolvedValue([
      {
        serviceId,
        tenant_id: tenantId,
        languages: [
          {
            ID: 'l1',
            TRANSLATIONS: [
              { LOCALE: 'en', NAME: 'English', IS_CANONICAL: true },
            ],
          },
        ],
      },
    ]);
    const result = await service.findById(serviceId, {
      headers: headers('vi'),
    });
    const langs = result.languages as Record<string, unknown>[];
    const translations = langs[0].TRANSLATIONS as Record<string, unknown>[];
    expect(translations).toHaveLength(1);
    expect(translations[0].LOCALE).toBe('en');
  });
});
