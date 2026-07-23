import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ResourceService } from './resource.service';
import { Resource } from 'src/common/schemas/resource.schema';
import { Redirect } from 'src/common/schemas/redirect.schema';
import { HeadersDto } from 'src/common/dto/headers.dto';

describe('ResourceService', () => {
  let service: ResourceService;
  const aggregateExec = jest.fn();
  const mockAggregate = jest.fn(() => ({ exec: aggregateExec }));
  const mockFindExec = jest.fn();
  const mockFindLean = jest.fn(() => ({ exec: mockFindExec }));
  const mockFind = jest.fn(() => ({ lean: mockFindLean }));

  const mockResourceModel = {
    aggregate: mockAggregate,
    find: mockFind,
  };

  const mockRedirectModel = {
    findById: jest.fn(),
  };

  const tenantId = 'tenant-abc';
  const salId = 'sal-123';
  const headers: HeadersDto = {
    'accept-language': 'en',
    'x-tenant-id': tenantId,
  };

  const baseTranslation = {
    displayName: 'Test Resource',
    locale: 'en',
    taxonomies: [],
    serviceName: 'Service',
    serviceDescription: 'Description',
    organizationDescription: 'Org',
    contacts: [],
  };

  const buildResource = (overrides: Record<string, unknown> = {}) => ({
    _id: salId,
    serviceAtLocationId: salId,
    tenant_id: tenantId,
    displayName: 'Test Resource',
    translations: [baseTranslation],
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResourceService,
        {
          provide: getModelToken(Resource.name),
          useValue: mockResourceModel,
        },
        {
          provide: getModelToken(Redirect.name),
          useValue: mockRedirectModel,
        },
      ],
    }).compile();

    service = module.get<ResourceService>(ResourceService);
    jest.clearAllMocks();
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'debug').mockImplementation(() => undefined);
  });

  describe('findById', () => {
    it('returns resource via primary path without fallback warning', async () => {
      aggregateExec.mockResolvedValueOnce([buildResource()]);

      const result = await service.findById(salId, { headers });

      expect(mockAggregate).toHaveBeenCalledTimes(1);
      expect(mockAggregate).toHaveBeenCalledWith([
        { $match: { tenant_id: tenantId, serviceAtLocationId: salId } },
        expect.any(Object),
      ]);
      expect(service['logger'].warn).not.toHaveBeenCalled();
      expect(result.displayName).toBe('Test Resource');
      expect(result.translation.locale).toBe('en');
    });

    it('uses fallback path and logs when primary lookup misses', async () => {
      aggregateExec
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([buildResource()]);

      const result = await service.findById(salId, { headers });

      expect(mockAggregate).toHaveBeenCalledTimes(2);
      expect(mockAggregate).toHaveBeenNthCalledWith(2, [
        { $match: { tenant_id: tenantId, _id: salId } },
        expect.any(Object),
      ]);
      expect(service['logger'].warn).toHaveBeenCalledWith(
        expect.stringContaining('"lookupPath":"fallback"'),
      );
      expect(result.displayName).toBe('Test Resource');
    });

    it('throws NotFoundException when all lookup paths miss', async () => {
      aggregateExec
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      mockRedirectModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.findById(salId, { headers })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('uses cross-tenant fallback_no_tenant path and logs when tenant-scoped lookups miss', async () => {
      aggregateExec
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([buildResource({ tenant_id: 'other-tenant' })]);

      const result = await service.findById(salId, { headers });

      expect(mockAggregate).toHaveBeenCalledTimes(3);
      expect(mockAggregate).toHaveBeenNthCalledWith(3, [
        { $match: { serviceAtLocationId: salId } },
        expect.any(Object),
      ]);
      expect(service['logger'].warn).toHaveBeenCalledWith(
        expect.stringContaining('"lookupPath":"fallback_no_tenant"'),
      );
      expect(result.displayName).toBe('Test Resource');
    });

    it('returns redirect payload when resource is missing but redirect exists', async () => {
      aggregateExec
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      mockRedirectModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ newId: 'new-sal-id' }),
      });

      await expect(service.findById(salId, { headers })).rejects.toMatchObject({
        response: { redirect: '/search/new-sal-id' },
      });
    });

    it('does not return a resource from another tenant when none exists at all', async () => {
      aggregateExec
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await expect(
        service.findById(salId, {
          headers: { ...headers, 'x-tenant-id': 'other-tenant' },
        }),
      ).rejects.toThrow(NotFoundException);

      expect(mockAggregate).toHaveBeenCalledWith([
        {
          $match: {
            tenant_id: 'other-tenant',
            serviceAtLocationId: salId,
          },
        },
        expect.any(Object),
      ]);
    });
  });

  describe('findByOriginalId', () => {
    it('scopes lookup by tenant_id and originalId', async () => {
      aggregateExec.mockResolvedValueOnce([
        buildResource({ originalId: 'orig-1' }),
      ]);

      await service.findByOriginalId('orig-1', { headers });

      expect(mockAggregate).toHaveBeenCalledWith([
        { $match: { tenant_id: tenantId, originalId: 'orig-1' } },
        expect.any(Object),
      ]);
    });
  });

  describe('findManyByIds', () => {
    it('returns batch results keyed by requested SAL ids via primary path', async () => {
      aggregateExec.mockResolvedValueOnce([
        buildResource({ _id: salId, serviceAtLocationId: salId }),
        buildResource({
          _id: 'sal-456',
          serviceAtLocationId: 'sal-456',
          displayName: 'Second Resource',
        }),
      ]);

      const result = await service.findManyByIds([salId, 'sal-456'], {
        headers,
      });

      expect(mockAggregate).toHaveBeenCalledTimes(1);
      expect(result.data[salId]).toBeDefined();
      expect(result.data['sal-456']).toBeDefined();
      expect(result.errors).toHaveLength(0);
      expect(result.meta.successful).toBe(2);
    });

    it('uses fallback for missing primary ids and logs each fallback hit', async () => {
      aggregateExec
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([buildResource()]);

      const result = await service.findManyByIds([salId], { headers });

      expect(mockAggregate).toHaveBeenCalledTimes(2);
      expect(service['logger'].warn).toHaveBeenCalledWith(
        expect.stringContaining('"handler":"findManyByIds"'),
      );
      expect(result.data[salId]).toBeDefined();
      expect(result.errors).toHaveLength(0);
    });

    it('reports missing ids as batch errors', async () => {
      aggregateExec.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      mockRedirectModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      const result = await service.findManyByIds(['missing-id'], { headers });

      expect(result.data).toEqual({});
      expect(result.errors).toEqual([
        {
          id: 'missing-id',
          reason: 'Resource not found',
          statusCode: 404,
        },
      ]);
    });
  });

  describe('findTitlesByIds', () => {
    it('returns titles from primary lookup', async () => {
      mockFindExec.mockResolvedValueOnce([
        { serviceAtLocationId: salId, displayName: 'Primary Title' },
      ]);

      const result = await service.findTitlesByIds([salId], tenantId);

      expect(mockFind).toHaveBeenCalledWith(
        { tenant_id: tenantId, serviceAtLocationId: { $in: [salId] } },
        { serviceAtLocationId: 1, displayName: 1 },
      );
      expect(result).toEqual([{ id: salId, displayName: 'Primary Title' }]);
    });

    it('falls back to _id lookup for missing primary ids', async () => {
      mockFindExec
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ _id: salId, displayName: 'Fallback Title' }]);

      const result = await service.findTitlesByIds([salId], tenantId);

      expect(mockFind).toHaveBeenCalledTimes(2);
      expect(service['logger'].warn).toHaveBeenCalledWith(
        expect.stringContaining('"handler":"findTitlesByIds"'),
      );
      expect(result).toEqual([{ id: salId, displayName: 'Fallback Title' }]);
    });

    it('looks up across all tenants when tenantId is not provided', async () => {
      mockFindExec.mockResolvedValueOnce([
        { serviceAtLocationId: salId, displayName: 'Global Title' },
      ]);

      const result = await service.findTitlesByIds([salId]);

      expect(mockFind).toHaveBeenCalledWith(
        { serviceAtLocationId: { $in: [salId] } },
        { serviceAtLocationId: 1, displayName: 1 },
      );
      expect(result).toEqual([{ id: salId, displayName: 'Global Title' }]);
    });
  });

  describe('transformResourceWithTranslations', () => {
    it('throws BadRequestException when locale translation is missing', async () => {
      aggregateExec.mockResolvedValueOnce([
        buildResource({
          translations: [{ ...baseTranslation, locale: 'es' }],
        }),
      ]);

      await expect(service.findById(salId, { headers })).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
