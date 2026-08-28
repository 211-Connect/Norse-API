import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { OrganizationDetailService } from './organization-detail.service';
import { Organization } from 'src/common/schemas/organization.schema';
import { Redirect } from 'src/common/schemas/redirect.schema';
import { HeadersDto } from 'src/common/dto/headers.dto';

describe('OrganizationDetailService', () => {
  let service: OrganizationDetailService;

  const aggregateExec = jest.fn();
  const mockAggregate = jest.fn(() => ({ exec: aggregateExec }));
  const mockOrganizationModel = { aggregate: mockAggregate };
  const mockRedirectModel = { findById: jest.fn(() => ({ exec: jest.fn() })) };

  const tenantId = '53fe1d2f-7366-4535-be92-400f701f0ab9';
  const orgId = 'e2ee3025-1389-52a7-861d-ac8b42eb3f04';
  const salId = 'f12bd3df-4f70-58d4-93aa-6da31ff19170';
  const headers: HeadersDto = {
    'accept-language': 'en',
    'x-tenant-id': tenantId,
  };

  const buildOrg = (overrides: Record<string, unknown> = {}) => ({
    _id: orgId,
    organizationId: orgId,
    tenant_id: tenantId,
    name: 'Teen Line',
    logo: { url: 'https://example.com/logo.png' },
    translations: [
      { LOCALE: 'en', DESCRIPTION: 'English description', IS_CANONICAL: true },
      { LOCALE: 'es', DESCRIPTION: 'Descripcion' },
    ],
    phones: [
      {
        ID: 'p1',
        NUMBER: '555-1000',
        TRANSLATIONS: [
          { LOCALE: 'en', DESCRIPTION: 'Main', IS_CANONICAL: true },
          { LOCALE: 'es', DESCRIPTION: 'Principal' },
        ],
      },
    ],
    services: [
      {
        ID: 's1',
        NAME: 'Counseling',
        ATTRIBUTE_TAXONOMIES: [{ ID: 'at1' }],
        CUSTOM_ATTRIBUTES: [{ ID: 'ca1' }],
        COST_OPTIONS: [{ ID: 'co1' }],
        SERVICE_AT_LOCATIONS: [{ ID: salId, LOCATION_ID: 'loc1' }],
        SCHEDULES: [
          {
            ID: 'sch1',
            TRANSLATIONS: [
              // No `en` row: exercises canonical fallback.
              { LOCALE: 'vi', DESCRIPTION: 'Gio', IS_CANONICAL: true },
              { LOCALE: 'es', DESCRIPTION: 'Horario' },
            ],
          },
        ],
        SERVICE_AREAS: [
          {
            ID: 'sa1',
            NAME: 'County',
            TRANSLATIONS: [
              { LOCALE: 'en', DESCRIPTION: 'Area', IS_CANONICAL: true },
              { LOCALE: 'es', DESCRIPTION: 'Zona' },
            ],
          },
        ],
      },
    ],
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationDetailService,
        {
          provide: getModelToken(Organization.name),
          useValue: mockOrganizationModel,
        },
        { provide: getModelToken(Redirect.name), useValue: mockRedirectModel },
      ],
    }).compile();

    service = module.get(OrganizationDetailService);
  });

  it('returns es translations where present and keeps them as arrays at every nesting level', async () => {
    aggregateExec.mockResolvedValueOnce([buildOrg()]);

    const result = (await service.findById(orgId, {
      headers: { ...headers, 'accept-language': 'es' },
    })) as unknown as Record<string, any>;

    expect(mockAggregate).toHaveBeenCalledTimes(1);
    expect(result.name).toBe('Teen Line');

    // Org-level: array, filtered to es.
    expect(result.translations).toEqual([
      { LOCALE: 'es', DESCRIPTION: 'Descripcion' },
    ]);
    // phones[].TRANSLATIONS
    expect(result.phones[0].TRANSLATIONS).toEqual([
      { LOCALE: 'es', DESCRIPTION: 'Principal' },
    ]);
    // services[].SERVICE_AREAS[].TRANSLATIONS
    expect(result.services[0].SERVICE_AREAS[0].TRANSLATIONS).toEqual([
      { LOCALE: 'es', DESCRIPTION: 'Zona' },
    ]);
    // services[].SCHEDULES[].TRANSLATIONS (es present)
    expect(result.services[0].SCHEDULES[0].TRANSLATIONS).toEqual([
      { LOCALE: 'es', DESCRIPTION: 'Horario' },
    ]);
    // SAL references remain on services
    expect(result.services[0].SERVICE_AT_LOCATIONS).toEqual([
      { ID: salId, LOCATION_ID: 'loc1' },
    ]);
  });

  it('falls back to English then canonical when the requested locale is absent, per node', async () => {
    aggregateExec.mockResolvedValueOnce([buildOrg()]);

    const result = (await service.findById(orgId, {
      headers: { ...headers, 'accept-language': 'fr' },
    })) as unknown as Record<string, any>;

    // fr absent -> English at org level.
    expect(result.translations).toEqual([
      { LOCALE: 'en', DESCRIPTION: 'English description', IS_CANONICAL: true },
    ]);
    // Schedule has neither fr nor en -> canonical (vi) row.
    expect(result.services[0].SCHEDULES[0].TRANSLATIONS).toEqual([
      { LOCALE: 'vi', DESCRIPTION: 'Gio', IS_CANONICAL: true },
    ]);
    // Service area has en -> English.
    expect(result.services[0].SERVICE_AREAS[0].TRANSLATIONS).toEqual([
      { LOCALE: 'en', DESCRIPTION: 'Area', IS_CANONICAL: true },
    ]);
  });

  it('drops top-level _id and logo but keeps kept-per-product service fields', async () => {
    aggregateExec.mockResolvedValueOnce([buildOrg()]);

    const result = (await service.findById(orgId, {
      headers,
    })) as unknown as Record<string, any>;

    expect(result._id).toBeUndefined();
    expect(result.logo).toBeUndefined();
    expect(result.organizationId).toBe(orgId);

    expect(result.services[0].ATTRIBUTE_TAXONOMIES).toEqual([{ ID: 'at1' }]);
    expect(result.services[0].CUSTOM_ATTRIBUTES).toEqual([{ ID: 'ca1' }]);
    expect(result.services[0].COST_OPTIONS).toEqual([{ ID: 'co1' }]);
  });

  it('returns an empty translations array when neither locale, English, nor canonical is present', async () => {
    aggregateExec.mockResolvedValueOnce([
      buildOrg({ translations: [{ LOCALE: 'de', DESCRIPTION: 'Nur DE' }] }),
    ]);

    const result = (await service.findById(orgId, {
      headers,
    })) as unknown as Record<string, any>;

    expect(result.translations).toEqual([]);
  });

  it('walks the 3-tier fallback chain then throws NotFound', async () => {
    aggregateExec
      .mockResolvedValueOnce([]) // primary: tenant + organizationId
      .mockResolvedValueOnce([]) // fallback: tenant + _id
      .mockResolvedValueOnce([]); // fallback_no_tenant: organizationId
    mockRedirectModel.findById.mockReturnValueOnce({
      exec: jest.fn().mockResolvedValueOnce(null),
    });

    await expect(service.findById(orgId, { headers })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(mockAggregate).toHaveBeenCalledTimes(3);
  });

  it('throws NotFound with a redirect hint when a redirect exists', async () => {
    aggregateExec
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mockRedirectModel.findById.mockReturnValueOnce({
      exec: jest.fn().mockResolvedValueOnce({ newId: 'new-org-id' }),
    });

    await expect(service.findById(orgId, { headers })).rejects.toMatchObject({
      response: { redirect: '/search/new-org-id' },
    });
  });
});
