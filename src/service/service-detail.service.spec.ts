import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { ServiceDetailService } from './service-detail.service';
import { Service } from 'src/common/schemas/service.schema';
import { HeadersDto } from 'src/common/dto/headers.dto';

describe('ServiceDetailService', () => {
  let service: ServiceDetailService;

  const aggregateExec = jest.fn();
  let seenPipeline: Record<string, unknown>[] | undefined;
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

  it('has no no-tenant fallback', async () => {
    aggregateExec.mockResolvedValue([]);
    await expect(
      service.findById(serviceId, { headers: headers() }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockAggregate).toHaveBeenCalledTimes(1);
  });

  it('narrows translations inside the pipeline, before transfer', async () => {
    aggregateExec.mockResolvedValue([{ serviceId, tenant_id: tenantId }]);
    await service.findById(serviceId, { headers: headers('es') });
    const addFields = stageNamed('$addFields');
    expect(addFields).toBeDefined();
    const json = JSON.stringify(addFields);
    expect(json).toContain('"$$t.LOCALE",{"$literal":"es"}');
    expect(json).toContain('"$$t.LOCALE","en"');
    expect(json).toContain('IS_CANONICAL');
  });

  // `accept-language` is caller-controlled. Unwrapped, Mongo reads `$x` as a
  // field path and `$$x` as a variable — an unknown one fails the whole
  // pipeline, a 500 on any id.
  it('passes the locale to Mongo as a literal, never as an expression', async () => {
    aggregateExec.mockResolvedValue([{ serviceId, tenant_id: tenantId }]);
    const locale = '$$x';
    await service.findById(serviceId, { headers: headers(locale) });

    const unwrapped: string[] = [];
    const walk = (node: unknown, parentKey?: string) => {
      if (node === locale && parentKey !== '$literal') {
        unwrapped.push(String(parentKey));
      } else if (Array.isArray(node)) {
        node.forEach((item) => walk(item, parentKey));
      } else if (node !== null && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) walk(value, key);
      }
    };
    const addFields = stageNamed('$addFields');
    walk(addFields);

    expect(JSON.stringify(addFields)).toContain(`{"$literal":"${locale}"}`);
    expect(unwrapped).toEqual([]);
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
    // Two levels: a location's own arrays carry translations too.
    expect(json).toContain('$$loc.SCHEDULES');
    expect(json).toContain('$$loc.LANGUAGES');
  });

  it('leaves an orphan service null rather than inventing an organization', async () => {
    aggregateExec.mockResolvedValue([{ serviceId, tenant_id: tenantId }]);
    await service.findById(serviceId, { headers: headers() });
    const json = JSON.stringify(stageNamed('$addFields'));
    expect(json).toContain('$cond');
    expect(json).toContain('missing');
  });

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
