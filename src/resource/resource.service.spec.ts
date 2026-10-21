import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ResourceService } from './resource.service';
import { Resource } from 'src/common/schemas/resource.schema';
import { Redirect } from 'src/common/schemas/redirect.schema';
import { ResourceTitleSnapshot } from 'src/common/schemas/resource-title-snapshot.schema';
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

  const snapshotFindExec = jest.fn();
  const mockTitleSnapshotModel = {
    bulkWrite: jest.fn().mockResolvedValue({}),
    find: jest.fn(() => ({ lean: () => ({ exec: snapshotFindExec }) })),
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
        {
          provide: getModelToken(ResourceTitleSnapshot.name),
          useValue: mockTitleSnapshotModel,
        },
      ],
    }).compile();

    service = module.get<ResourceService>(ResourceService);
    jest.clearAllMocks();
    snapshotFindExec.mockResolvedValue([]);
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

    it('seeds a title snapshot for the loaded resource', async () => {
      aggregateExec.mockResolvedValueOnce([
        buildResource({ originalId: 'orig-1' }),
      ]);

      await service.findByOriginalId('orig-1', { headers });

      expect(mockTitleSnapshotModel.bulkWrite).toHaveBeenCalledWith(
        [
          {
            updateOne: {
              filter: { tenant_id: tenantId, serviceAtLocationId: salId },
              update: { $set: { displayName: 'Test Resource' } },
              upsert: true,
            },
          },
        ],
        { ordered: false },
      );
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

    it('uses cross-tenant fallback_no_tenant for missing tenant-scoped ids and logs', async () => {
      aggregateExec
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([buildResource({ tenant_id: 'other-tenant' })]);

      const result = await service.findManyByIds([salId], { headers });

      expect(mockAggregate).toHaveBeenCalledTimes(3);
      expect(mockAggregate).toHaveBeenNthCalledWith(3, [
        { $match: { serviceAtLocationId: { $in: [salId] } } },
        expect.any(Object),
      ]);
      expect(service['logger'].warn).toHaveBeenCalledWith(
        expect.stringContaining('"lookupPath":"fallback_no_tenant"'),
      );
      expect(result.data[salId]).toBeDefined();
      expect(result.errors).toHaveLength(0);
    });

    it('reports missing ids as batch errors', async () => {
      aggregateExec
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
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
    it('resolves a serviceAtLocationId with a single live query', async () => {
      mockFindExec.mockResolvedValueOnce([
        {
          _id: 'mongo-1',
          serviceAtLocationId: salId,
          displayName: 'Primary Title',
          tenant_id: tenantId,
        },
      ]);

      const result = await service.findTitlesByIds([salId], tenantId);

      expect(mockFind).toHaveBeenCalledTimes(1);
      expect(mockFind).toHaveBeenCalledWith(
        {
          tenant_id: tenantId,
          $or: [
            { serviceAtLocationId: { $in: [salId] } },
            { _id: { $in: [salId] } },
          ],
        },
        { _id: 1, serviceAtLocationId: 1, displayName: 1, tenant_id: 1 },
      );
      expect(result).toEqual([{ id: salId, displayName: 'Primary Title' }]);
    });

    it('resolves a legacy mongo _id in the same query and logs the fallback', async () => {
      mockFindExec.mockResolvedValueOnce([
        { _id: salId, displayName: 'Fallback Title', tenant_id: tenantId },
      ]);

      const result = await service.findTitlesByIds([salId], tenantId);

      expect(mockFind).toHaveBeenCalledTimes(1);
      expect(service['logger'].warn).toHaveBeenCalledWith(
        expect.stringContaining('"handler":"findTitlesByIds"'),
      );
      expect(result).toEqual([{ id: salId, displayName: 'Fallback Title' }]);
    });

    it('resolves both id forms from one document', async () => {
      mockFindExec.mockResolvedValueOnce([
        {
          _id: 'mongo-1',
          serviceAtLocationId: salId,
          displayName: 'Both Ids',
          tenant_id: tenantId,
        },
      ]);

      const result = await service.findTitlesByIds(
        [salId, 'mongo-1'],
        tenantId,
      );

      expect(result).toEqual([
        { id: salId, displayName: 'Both Ids' },
        { id: 'mongo-1', displayName: 'Both Ids' },
      ]);
    });

    it('does not resolve an id superseded by a republish', async () => {
      mockFindExec.mockResolvedValueOnce([]);

      const result = await service.findTitlesByIds(
        ['sal-superseded'],
        tenantId,
      );

      expect(result).toEqual([]);
    });

    it('snapshots resolved titles for later lookups', async () => {
      mockFindExec.mockResolvedValueOnce([
        {
          serviceAtLocationId: salId,
          displayName: 'Primary Title',
          tenant_id: tenantId,
        },
      ]);

      await service.findTitlesByIds([salId], tenantId);

      expect(mockTitleSnapshotModel.bulkWrite).toHaveBeenCalledWith(
        [
          {
            updateOne: {
              filter: { tenant_id: tenantId, serviceAtLocationId: salId },
              update: { $set: { displayName: 'Primary Title' } },
              upsert: true,
            },
          },
        ],
        { ordered: false },
      );
    });

    it('does not snapshot a resource that has no serviceAtLocationId', async () => {
      mockFindExec.mockResolvedValueOnce([
        { _id: salId, displayName: 'Legacy Title', tenant_id: tenantId },
      ]);

      const result = await service.findTitlesByIds([salId], tenantId);

      expect(result).toEqual([{ id: salId, displayName: 'Legacy Title' }]);
      expect(mockTitleSnapshotModel.bulkWrite).not.toHaveBeenCalled();
    });

    it('snapshots the serviceAtLocationId when a legacy _id resolves to a resource that has one', async () => {
      mockFindExec.mockResolvedValueOnce([
        {
          _id: 'legacy-mongo-id',
          serviceAtLocationId: salId,
          displayName: 'Legacy Title',
          tenant_id: tenantId,
        },
      ]);

      await service.findTitlesByIds(['legacy-mongo-id'], tenantId);

      expect(mockTitleSnapshotModel.bulkWrite).toHaveBeenCalledWith(
        [
          {
            updateOne: {
              filter: { tenant_id: tenantId, serviceAtLocationId: salId },
              update: { $set: { displayName: 'Legacy Title' } },
              upsert: true,
            },
          },
        ],
        { ordered: false },
      );
    });

    it('does not fail the lookup when snapshotting fails', async () => {
      mockFindExec.mockResolvedValueOnce([
        {
          serviceAtLocationId: salId,
          displayName: 'Primary Title',
          tenant_id: tenantId,
        },
      ]);
      mockTitleSnapshotModel.bulkWrite.mockRejectedValueOnce(
        new Error('mongo down'),
      );

      const result = await service.findTitlesByIds([salId], tenantId);

      expect(result).toEqual([{ id: salId, displayName: 'Primary Title' }]);
    });

    it('falls back to snapshots for resources that no longer exist', async () => {
      mockFindExec.mockResolvedValueOnce([]);
      snapshotFindExec.mockResolvedValueOnce([
        { serviceAtLocationId: salId, displayName: 'Last Known Title' },
      ]);

      const result = await service.findTitlesByIds([salId], tenantId);

      expect(snapshotFindExec).toHaveBeenCalledTimes(1);
      expect(mockTitleSnapshotModel.find).toHaveBeenCalledWith(
        { tenant_id: tenantId, serviceAtLocationId: { $in: [salId] } },
        { serviceAtLocationId: 1, displayName: 1 },
      );
      expect(result).toEqual([{ id: salId, displayName: 'Last Known Title' }]);
      expect(mockTitleSnapshotModel.bulkWrite).not.toHaveBeenCalled();
    });

    it('omits ids that cannot be resolved by any path', async () => {
      mockFindExec.mockResolvedValueOnce([]);

      const result = await service.findTitlesByIds(['gone-id'], tenantId);

      expect(result).toEqual([]);
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
