import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  PrintableDirectory,
  PrintableDirectorySection,
} from 'src/common/schemas/printable-directory.schema';
import { FavoriteList } from 'src/common/schemas/favorite-list.schema';
import { SearchService } from 'src/search/search.service';
import { ResourceService } from 'src/resource/resource.service';
import { FavoriteListService } from 'src/favorite-list/favorite-list.service';
import { PrintableDirectoryService } from './printable-directory.service';

describe('PrintableDirectoryService', () => {
  let service: PrintableDirectoryService;

  const mockPrintableDirectoryModel = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    countDocuments: jest.fn(),
    deleteOne: jest.fn(),
  };

  const mockFavoriteListModel = {
    findOne: jest.fn(),
  };

  const mockSearchService = {
    searchResources: jest.fn(),
  };

  const mockResourceService = {
    findManyByIds: jest.fn(),
    findTitlesByIds: jest.fn().mockResolvedValue([]),
  };

  const mockFavoriteListService = {
    findSummariesByIds: jest.fn().mockResolvedValue([]),
  };

  const scope = {
    tenantId: 'tenant-1',
    userId: 'user-1',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrintableDirectoryService,
        {
          provide: getModelToken(PrintableDirectory.name),
          useValue: mockPrintableDirectoryModel,
        },
        {
          provide: getModelToken(FavoriteList.name),
          useValue: mockFavoriteListModel,
        },
        {
          provide: SearchService,
          useValue: mockSearchService,
        },
        {
          provide: ResourceService,
          useValue: mockResourceService,
        },
        {
          provide: FavoriteListService,
          useValue: mockFavoriteListService,
        },
      ],
    }).compile();

    service = module.get<PrintableDirectoryService>(PrintableDirectoryService);
    jest.clearAllMocks();
  });

  const createDirectoryDoc = (
    overrides?: Partial<{
      sections: PrintableDirectorySection[];
      tenantId: string;
      ownerUserId: string;
      name: string;
      defaultQueryConfig: {
        locationName?: string | null;
        coords?: { latitude: number; longitude: number } | null;
        radius?: number | null;
      } | null;
    }>,
  ) => {
    return {
      _id: 'directory-1',
      tenantId: overrides?.tenantId ?? scope.tenantId,
      ownerUserId: overrides?.ownerUserId ?? scope.userId,
      name: overrides?.name ?? 'Directory',
      updatedBy: scope.userId,
      accessPolicy: 'private',
      cover: {
        titleLocalized: { values: {} },
        descriptionLocalized: { values: {} },
        primaryColor: null,
        layoutType: 'default',
        coverImageUrlFront: null,
        coverImageUrlBack: null,
      },
      header: {
        layout: [],
        textLocalized: { values: {} },
        logoUrl: null,
      },
      footer: {
        layout: [],
        textLocalized: { values: {} },
        logoUrl: null,
      },
      resourceLayout: 'standard',
      defaultQueryConfig: overrides?.defaultQueryConfig ?? null,
      sections: overrides?.sections ?? [],
      createdAt: new Date('2026-07-08T08:00:00.000Z'),
      updatedAt: new Date('2026-07-08T09:00:00.000Z'),
      save: jest.fn().mockResolvedValue(undefined),
    } as any;
  };

  it('creates a directory for the current tenant and owner', async () => {
    const doc = createDirectoryDoc({ name: 'My Directory' });
    mockPrintableDirectoryModel.create.mockResolvedValue(doc);

    const result = await service.create({ name: 'My Directory' }, scope);

    expect(mockPrintableDirectoryModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: scope.tenantId,
        ownerUserId: scope.userId,
        name: 'My Directory',
      }),
    );
    expect(result.name).toBe('My Directory');
  });

  it('defaults isBookletLayout to false when creating a directory', async () => {
    const doc = createDirectoryDoc({ name: 'My Directory' });
    mockPrintableDirectoryModel.create.mockResolvedValue(doc);

    const result = await service.create({ name: 'My Directory' }, scope);

    expect(mockPrintableDirectoryModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ isBookletLayout: false }),
    );
    expect(result.isBookletLayout).toBe(false);
  });

  it('defaults isBookletLayout to false for existing directories missing the field in MongoDB', async () => {
    const doc = createDirectoryDoc();
    delete doc.isBookletLayout;
    mockPrintableDirectoryModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(doc),
    });

    const result = await service.getById('directory-1', scope);

    expect(result.isBookletLayout).toBe(false);
  });

  it('updates isBookletLayout when provided', async () => {
    const doc = createDirectoryDoc();
    mockPrintableDirectoryModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(doc),
    });

    const result = await service.update(
      'directory-1',
      { isBookletLayout: true },
      scope,
    );

    expect(doc.isBookletLayout).toBe(true);
    expect(doc.save).toHaveBeenCalled();
    expect(result.isBookletLayout).toBe(true);
  });

  it('lists directories with pagination for owner scope', async () => {
    const findExec = jest.fn().mockResolvedValue([createDirectoryDoc()]);
    const findChain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: findExec,
    };
    mockPrintableDirectoryModel.find.mockReturnValue(findChain);
    mockPrintableDirectoryModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(1),
    });

    const result = await service.list({ page: 1, limit: 20 }, scope);

    expect(mockPrintableDirectoryModel.find).toHaveBeenCalledWith({
      tenantId: scope.tenantId,
      $or: [
        { ownerUserId: scope.userId },
        { accessPolicy: { $in: ['shared-read', 'shared-edit'] } },
      ],
    });
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
  });

  it('enforces tenant/owner isolation on getById', async () => {
    mockPrintableDirectoryModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    await expect(service.getById('directory-1', scope)).rejects.toThrow(
      NotFoundException,
    );
    expect(mockPrintableDirectoryModel.findOne).toHaveBeenCalledWith({
      _id: 'directory-1',
      tenantId: scope.tenantId,
      $or: [
        { ownerUserId: scope.userId },
        { accessPolicy: { $in: ['shared-read', 'shared-edit'] } },
      ],
    });
  });

  it('reorders sections with stable order values', async () => {
    const directory = createDirectoryDoc({
      sections: [
        {
          id: 'a',
          order: 0,
          headingLocalized: { values: { en: 'A' } },
          descriptionLocalized: { values: {} },
          maxResources: 10,
          sources: [],
        },
        {
          id: 'b',
          order: 1,
          headingLocalized: { values: { en: 'B' } },
          descriptionLocalized: { values: {} },
          maxResources: 10,
          sources: [],
        },
      ],
    });

    mockPrintableDirectoryModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(directory),
    });

    const result = await service.reorderSections(
      'directory-1',
      { sectionIds: ['b', 'a'] },
      scope,
    );

    expect(directory.save).toHaveBeenCalled();
    expect(result.sections[0].id).toBe('b');
    expect(result.sections[0].order).toBe(0);
    expect(result.sections[1].id).toBe('a');
    expect(result.sections[1].order).toBe(1);
  });

  it('fails reorder when provided ids mismatch existing sections', async () => {
    const directory = createDirectoryDoc({
      sections: [
        {
          id: 'a',
          order: 0,
          headingLocalized: { values: { en: 'A' } },
          descriptionLocalized: { values: {} },
          maxResources: 10,
          sources: [],
        },
      ],
    });

    mockPrintableDirectoryModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(directory),
    });

    await expect(
      service.reorderSections(
        'directory-1',
        { sectionIds: ['missing'] },
        scope,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('resolves preview query source with dedupe and maxResources', async () => {
    const directory = createDirectoryDoc({
      sections: [
        {
          id: 'section-1',
          order: 0,
          headingLocalized: { values: { en: 'Heading' } },
          descriptionLocalized: { values: { en: 'desc' } },
          maxResources: 2,
          sources: [
            {
              id: 'src-1',
              order: 0,
              type: 'query',
              query: {
                title: 'q',
                params: {
                  query: 'housing',
                  query_type: 'text',
                  page: 1,
                  limit: 25,
                },
              },
              favoritesListId: null,
              resourceIds: [],
            },
            {
              id: 'src-2',
              order: 1,
              type: 'resource_ids',
              query: null,
              favoritesListId: null,
              resourceIds: ['resource-2', 'resource-3'],
            },
          ],
        },
      ],
    });

    mockPrintableDirectoryModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(directory),
    });

    mockSearchService.searchResources.mockResolvedValue({
      search: {
        took: 10,
        timed_out: false,
        _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
        hits: {
          total: { value: 2, relation: 'eq' },
          hits: [
            { _id: 'resource-1', _source: { id: 'resource-1' } },
            { _id: 'resource-2', _source: { id: 'resource-2' } },
          ],
        },
      },
      facets: [],
    });

    mockResourceService.findManyByIds
      .mockResolvedValueOnce({
        data: {
          'resource-1': { _id: 'resource-1', displayName: 'R1' },
          'resource-2': { _id: 'resource-2', displayName: 'R2' },
        },
        errors: [],
        meta: { requested: 2, successful: 2, failed: 0 },
      })
      .mockResolvedValueOnce({
        data: {
          'resource-2': { _id: 'resource-2', displayName: 'R2' },
          'resource-3': { _id: 'resource-3', displayName: 'R3' },
        },
        errors: [],
        meta: { requested: 2, successful: 2, failed: 0 },
      });

    const result = await service.preview(
      'directory-1',
      'en',
      { 'x-tenant-id': scope.tenantId, 'accept-language': 'en' },
      scope,
    );

    expect(result.sections[0].resources.map((item) => item.id)).toEqual([
      'resource-1',
      'resource-2',
    ]);
    expect(result.sections[0].maxResources).toBe(2);
  });

  it('uses directory query defaults when query source params miss coords and distance', async () => {
    const directory = createDirectoryDoc({
      defaultQueryConfig: {
        locationName: 'Seattle, WA',
        coords: { latitude: 47.6062, longitude: -122.3321 },
        radius: 15,
      },
      sections: [
        {
          id: 'section-1',
          order: 0,
          headingLocalized: { values: { en: 'Heading' } },
          descriptionLocalized: { values: {} },
          maxResources: 10,
          sources: [
            {
              id: 'src-1',
              order: 0,
              type: 'query',
              query: {
                title: 'q',
                params: {
                  query: 'housing',
                  query_type: 'text',
                  page: 1,
                  limit: 25,
                },
              },
              favoritesListId: null,
              resourceIds: [],
            },
          ],
        },
      ],
    });

    mockPrintableDirectoryModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(directory),
    });

    mockSearchService.searchResources.mockResolvedValue({
      search: {
        took: 10,
        timed_out: false,
        _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
        hits: { total: { value: 0, relation: 'eq' }, hits: [] },
      },
      facets: [],
    });

    await service.preview(
      'directory-1',
      'en',
      { 'x-tenant-id': scope.tenantId, 'accept-language': 'en' },
      scope,
    );

    expect(mockSearchService.searchResources).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          coords: [-122.3321, 47.6062],
          distance: 15,
        }),
      }),
    );
  });

  it('prefers query source coords and distance over directory defaults', async () => {
    const directory = createDirectoryDoc({
      defaultQueryConfig: {
        locationName: 'Seattle, WA',
        coords: { latitude: 47.6062, longitude: -122.3321 },
        radius: 15,
      },
      sections: [
        {
          id: 'section-1',
          order: 0,
          headingLocalized: { values: { en: 'Heading' } },
          descriptionLocalized: { values: {} },
          maxResources: 10,
          sources: [
            {
              id: 'src-1',
              order: 0,
              type: 'query',
              query: {
                title: 'q',
                params: {
                  query: 'housing',
                  query_type: 'text',
                  page: 1,
                  limit: 25,
                  coords: [-73.935242, 40.73061],
                  distance: 30,
                },
              },
              favoritesListId: null,
              resourceIds: [],
            },
          ],
        },
      ],
    });

    mockPrintableDirectoryModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(directory),
    });

    mockSearchService.searchResources.mockResolvedValue({
      search: {
        took: 10,
        timed_out: false,
        _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
        hits: { total: { value: 0, relation: 'eq' }, hits: [] },
      },
      facets: [],
    });

    await service.preview(
      'directory-1',
      'en',
      { 'x-tenant-id': scope.tenantId, 'accept-language': 'en' },
      scope,
    );

    expect(mockSearchService.searchResources).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          coords: [-73.935242, 40.73061],
          distance: 30,
        }),
      }),
    );
  });

  it('resolves preview favorites_list source using owner and tenant scope', async () => {
    const directory = createDirectoryDoc({
      sections: [
        {
          id: 'section-1',
          order: 0,
          headingLocalized: { values: { en: 'Heading' } },
          descriptionLocalized: { values: {} },
          maxResources: 10,
          sources: [
            {
              id: 'src-1',
              order: 0,
              type: 'favorites_list',
              query: null,
              favoritesListId: 'fav-1',
              resourceIds: [],
            },
          ],
        },
      ],
    });

    mockPrintableDirectoryModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(directory),
    });

    mockFavoriteListModel.findOne.mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ favorites: ['resource-9'] }),
      }),
    });

    mockResourceService.findManyByIds.mockResolvedValue({
      data: {
        'resource-9': { _id: 'resource-9', displayName: 'R9' },
      },
      errors: [],
      meta: { requested: 1, successful: 1, failed: 0 },
    });

    await service.preview(
      'directory-1',
      'en',
      { 'x-tenant-id': scope.tenantId, 'accept-language': 'en' },
      scope,
    );

    expect(mockFavoriteListModel.findOne).toHaveBeenCalledWith({
      _id: 'fav-1',
      ownerId: scope.userId,
      tenantId: scope.tenantId,
    });
  });

  it('fails preview when resource resolution has errors', async () => {
    const directory = createDirectoryDoc({
      sections: [
        {
          id: 'section-1',
          order: 0,
          headingLocalized: { values: { en: 'Heading' } },
          descriptionLocalized: { values: {} },
          maxResources: 10,
          sources: [
            {
              id: 'src-1',
              order: 0,
              type: 'resource_ids',
              query: null,
              favoritesListId: null,
              resourceIds: ['missing'],
            },
          ],
        },
      ],
    });

    mockPrintableDirectoryModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(directory),
    });

    mockResourceService.findManyByIds.mockResolvedValue({
      data: {},
      errors: [{ id: 'missing', reason: 'not found', statusCode: 404 }],
      meta: { requested: 1, successful: 0, failed: 1 },
    });

    await expect(
      service.preview(
        'directory-1',
        'en',
        { 'x-tenant-id': scope.tenantId, 'accept-language': 'en' },
        scope,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
