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
    translations: [
      { LOCALE: 'en', DESCRIPTION: 'English description' },
      { LOCALE: 'es', DESCRIPTION: 'Descripcion' },
    ],
    services: [
      { ID: 's1', SERVICE_AT_LOCATIONS: [{ ID: salId, LOCATION_ID: 'loc1' }] },
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

  it('returns the org with the locale-resolved translation and no translations array', async () => {
    aggregateExec.mockResolvedValueOnce([buildOrg()]);

    const result = await service.findById(orgId, { headers });

    expect(mockAggregate).toHaveBeenCalledTimes(1);
    expect(result.name).toBe('Teen Line');
    expect(result.translation).toEqual({
      LOCALE: 'en',
      DESCRIPTION: 'English description',
    });
    // translations array collapsed away; SAL references remain on services
    expect((result as Record<string, unknown>).translations).toBeUndefined();
    expect(result.services[0].SERVICE_AT_LOCATIONS).toEqual([
      { ID: salId, LOCATION_ID: 'loc1' },
    ]);
  });

  it('falls back to English when the requested locale has no org description', async () => {
    aggregateExec.mockResolvedValueOnce([
      buildOrg({ translations: [{ LOCALE: 'en', DESCRIPTION: 'Only EN' }] }),
    ]);

    const result = await service.findById(orgId, {
      headers: { ...headers, 'accept-language': 'fr' },
    });

    expect(result.translation).toEqual({
      LOCALE: 'en',
      DESCRIPTION: 'Only EN',
    });
  });

  it('returns a null translation when neither the locale nor English is present', async () => {
    aggregateExec.mockResolvedValueOnce([buildOrg({ translations: [] })]);

    const result = await service.findById(orgId, { headers });

    expect(result.translation).toBeNull();
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
