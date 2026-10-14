import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { OrganizationDetailService } from './organization-detail.service';
import { Organization } from 'src/common/schemas/organization.schema';
import { Redirect } from 'src/common/schemas/redirect.schema';
import { HeadersDto } from 'src/common/dto/headers.dto';

describe('OrganizationDetailService', () => {
  let service: OrganizationDetailService;

  const aggregateExec = jest.fn();
  let seenPipelines: { $match?: Record<string, unknown> }[][] = [];
  const mockAggregate = jest.fn(
    (pipeline: { $match?: Record<string, unknown> }[]) => {
      seenPipelines.push(pipeline);
      return { exec: aggregateExec };
    },
  );
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
        SERVICE_AT_LOCATIONS: [
          {
            ID: salId,
            LOCATION_ID: 'loc1',
            // Attached to the pairing, not to the service or the location —
            // reachable nowhere else in the document.
            SCHEDULES: [
              {
                ID: 'salsch1',
                TRANSLATIONS: [
                  { LOCALE: 'en', DESCRIPTION: 'Pairing hours' },
                  { LOCALE: 'es', DESCRIPTION: 'Horario del sitio' },
                ],
              },
            ],
            DISPLAY: {
              PHONE_NUMBER: '555-2000',
              // app_organization_full filters DISPLAY's nested translations to
              // `en` upstream, so one row is what actually arrives here.
              PHONE_LIST: [
                {
                  ID: 'p2',
                  NUMBER: '555-2000',
                  TRANSLATIONS: [{ LOCALE: 'en', DESCRIPTION: 'Site line' }],
                },
              ],
              CONTACT_LIST: [],
              WEBSITE: 'https://example.com/site',
              SCHEDULE: 'Mon-Fri 9-5',
            },
          },
        ],
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
    seenPipelines = [];
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
    // SAL references remain on services, and the pairing keeps its id/link.
    const sal = result.services[0].SERVICE_AT_LOCATIONS[0];
    expect(sal.ID).toBe(salId);
    expect(sal.LOCATION_ID).toBe('loc1');

    // Schedules on the pairing survive the projection and are locale-filtered.
    expect(sal.SCHEDULES[0].TRANSLATIONS).toEqual([
      { LOCALE: 'es', DESCRIPTION: 'Horario del sitio' },
    ]);

    // DISPLAY is English throughout -- the schedule is a scalar, and its nested
    // phone/contact translations are filtered to `en` upstream rather than here.
    // So an `es` request still yields the English row, through the English
    // fallback in selectLocaleRows. That is correct: it is the only row there is.
    expect(sal.DISPLAY.PHONE_NUMBER).toBe('555-2000');
    expect(sal.DISPLAY.SCHEDULE).toBe('Mon-Fri 9-5');
    expect(sal.DISPLAY.PHONE_LIST[0].TRANSLATIONS).toEqual([
      { LOCALE: 'en', DESCRIPTION: 'Site line' },
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

  it('preserves duplicate rows for the resolved locale (no dedupe)', async () => {
    aggregateExec.mockResolvedValueOnce([
      buildOrg({
        translations: [
          { LOCALE: 'es', DESCRIPTION: 'Uno' },
          { LOCALE: 'es', DESCRIPTION: 'Dos' },
          { LOCALE: 'en', DESCRIPTION: 'English' },
        ],
      }),
    ]);

    const result = (await service.findById(orgId, {
      headers: { ...headers, 'accept-language': 'es' },
    })) as unknown as Record<string, any>;

    expect(result.translations).toEqual([
      { LOCALE: 'es', DESCRIPTION: 'Uno' },
      { LOCALE: 'es', DESCRIPTION: 'Dos' },
    ]);
  });

  it('collapses the canonical fallback to one locale when every row is over-flagged canonical (ISS-1281 data)', async () => {
    aggregateExec.mockResolvedValueOnce([
      buildOrg({
        translations: [
          { LOCALE: 'vi', DESCRIPTION: 'Mot', IS_CANONICAL: true },
          { LOCALE: 'vi', DESCRIPTION: 'Hai', IS_CANONICAL: true },
          { LOCALE: 'ar', DESCRIPTION: 'Wahid', IS_CANONICAL: true },
        ],
      }),
    ]);

    // Requested locale (zz) and English both absent; every remaining row is
    // canonical -> must return a single locale, not all of them.
    const result = (await service.findById(orgId, {
      headers: { ...headers, 'accept-language': 'zz' },
    })) as unknown as Record<string, any>;

    expect(result.translations).toEqual([
      { LOCALE: 'vi', DESCRIPTION: 'Mot', IS_CANONICAL: true },
      { LOCALE: 'vi', DESCRIPTION: 'Hai', IS_CANONICAL: true },
    ]);
  });

  it('walks the tenant-scoped lookups then throws NotFound', async () => {
    aggregateExec
      .mockResolvedValueOnce([]) // primary: tenant + organizationId
      .mockResolvedValueOnce([]); // fallback: tenant + _id
    mockRedirectModel.findById.mockReturnValueOnce({
      exec: jest.fn().mockResolvedValueOnce(null),
    });

    await expect(service.findById(orgId, { headers })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(mockAggregate).toHaveBeenCalledTimes(2);
  });

  // Asserts the query, not the outcome: a 404 on a miss would also pass while
  // the unscoped query was still being sent (ISS-1778).
  it('never issues a query without a tenant filter', async () => {
    aggregateExec.mockResolvedValue([]);
    mockRedirectModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    await expect(service.findById(orgId, { headers })).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(seenPipelines.length).toBeGreaterThan(0);
    for (const pipeline of seenPipelines) {
      const match = pipeline.find((stage) => '$match' in stage)?.$match ?? {};
      expect(Object.keys(match)).toContain('tenant_id');
      expect(match.tenant_id).toBe(tenantId);
    }
  });

  it("refuses an organization the caller's tenant does not own", async () => {
    aggregateExec.mockResolvedValue([]);
    mockRedirectModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.findById('an-id-owned-by-another-tenant', { headers }),
    ).rejects.toBeInstanceOf(NotFoundException);
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
  // ISS-2096: a Norse resource page knows only its tenant and the SAL id in
  // its URL. Tenant-scoped only: no legacy-_id, cross-tenant, or redirect tier.
  describe('findByServiceAtLocation', () => {
    const matchOf = (pipeline: { $match?: Record<string, unknown> }[]) =>
      pipeline.find((stage) => '$match' in stage)?.$match ?? {};

    // clearAllMocks keeps queued mockResolvedValueOnce values, and the redirect
    // test above leaves one unconsumed.
    beforeEach(() => aggregateExec.mockReset());

    it('returns the one org in the tenant whose services carry the SAL', async () => {
      aggregateExec.mockResolvedValueOnce([buildOrg()]);

      const result = (await service.findByServiceAtLocation(salId, {
        headers,
      })) as unknown as Record<string, any>;

      expect(result.organizationId).toBe(orgId);
      expect(result._id).toBeUndefined();
      expect(mockAggregate).toHaveBeenCalledTimes(1);
      expect(matchOf(seenPipelines[0])).toEqual({
        tenant_id: tenantId,
        'services.SERVICE_AT_LOCATIONS.ID': salId,
      });
    });

    it('throws NotFound for an unknown SAL with no fallback or redirect lookup', async () => {
      aggregateExec.mockResolvedValue([]);

      await expect(
        service.findByServiceAtLocation('unknown-sal', { headers }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(mockAggregate).toHaveBeenCalledTimes(1);
      expect(mockRedirectModel.findById).not.toHaveBeenCalled();
    });

    it('throws NotFound for a real SAL sent under another tenant, querying only that tenant', async () => {
      const otherTenant = '0e50850f-6a7f-49c1-9af8-7d124e2a7008';
      aggregateExec.mockResolvedValue([]);

      await expect(
        service.findByServiceAtLocation(salId, {
          headers: { ...headers, 'x-tenant-id': otherTenant },
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(seenPipelines).toHaveLength(1);
      expect(matchOf(seenPipelines[0]).tenant_id).toBe(otherTenant);
    });

    it('refuses to pick when two orgs in the tenant carry the SAL', async () => {
      aggregateExec.mockResolvedValueOnce([
        buildOrg(),
        buildOrg({ _id: 'other', organizationId: 'other-org' }),
      ]);

      await expect(
        service.findByServiceAtLocation(salId, { headers }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
