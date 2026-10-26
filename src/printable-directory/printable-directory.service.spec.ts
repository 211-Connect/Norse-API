import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrintableDirectory } from 'src/common/schemas/printable-directory.schema';
import { FavoriteList } from 'src/common/schemas/favorite-list.schema';
import { PrintableDirectoryDelivery } from 'src/common/schemas/printable-directory-delivery.schema';
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

  const mockDeliveryModel = {
    deleteMany: jest.fn(),
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
          provide: getModelToken(PrintableDirectoryDelivery.name),
          useValue: mockDeliveryModel,
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

  describe('remove', () => {
    it('deletes the directory and its scheduled deliveries', async () => {
      mockPrintableDirectoryModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: '6ad0dcb938dccb2e7af9f9d1' }),
      });
      mockPrintableDirectoryModel.deleteOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({}),
      });
      mockDeliveryModel.deleteMany.mockReturnValue({
        exec: jest.fn().mockResolvedValue({}),
      });

      await service.remove('6ad0dcb938dccb2e7af9f9d1', scope);

      expect(mockPrintableDirectoryModel.deleteOne).toHaveBeenCalledWith({
        _id: '6ad0dcb938dccb2e7af9f9d1',
      });
      expect(mockDeliveryModel.deleteMany).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        directoryId: '6ad0dcb938dccb2e7af9f9d1',
      });
    });
  });

  const createDirectoryDoc = (
    overrides?: Partial<{
      sections: any[];
      tenantId: string;
      ownerUserId: string;
      name: string;
      primaryLanguage: string;
      cover: Record<string, unknown>;
      defaultQueryConfig: {
        locationName?: string | null;
        coords?: { latitude: number; longitude: number } | null;
        radius?: number | null;
      } | null;
    }>,
  ) => {
    return {
      _id: '6ad0dcb938dccb2e7af9f9c1',
      tenantId: overrides?.tenantId ?? scope.tenantId,
      ownerUserId: overrides?.ownerUserId ?? scope.userId,
      name: overrides?.name ?? 'Directory',
      primaryLanguage: overrides?.primaryLanguage ?? 'en',
      updatedBy: scope.userId,
      accessPolicy: 'private',
      cover: overrides?.cover ?? {
        titleLocalized: { values: {}, autoTranslatedLocales: [] },
        descriptionLocalized: { values: {}, autoTranslatedLocales: [] },
        primaryColor: null,
        layoutType: 'default',
        coverImageUrlFront: null,
        coverImageUrlBack: null,
      },
      header: {
        layout: [],
        textLocalized: { values: {}, autoTranslatedLocales: [] },
      },
      footer: {
        layout: [],
        textLocalized: { values: {}, autoTranslatedLocales: [] },
      },
      logoUrl: null,
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

    const result = await service.create(
      { name: 'My Directory', primaryLanguage: 'en' },
      scope,
    );

    expect(mockPrintableDirectoryModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: scope.tenantId,
        ownerUserId: scope.userId,
        name: 'My Directory',
        primaryLanguage: 'en',
      }),
    );
    expect(result.name).toBe('My Directory');
    expect(result.primaryLanguage).toBe('en');
  });

  it('throws BadRequestException when trying to update primaryLanguage', async () => {
    const doc = createDirectoryDoc();
    mockPrintableDirectoryModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(doc),
    });

    await expect(
      service.update(
        '6ad0dcb938dccb2e7af9f9c1',
        { primaryLanguage: 'es' },
        scope,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('stores and returns autoTranslatedLocales for localized fields', async () => {
    const doc = createDirectoryDoc({ name: 'My Directory' });
    mockPrintableDirectoryModel.create.mockResolvedValue(doc);

    const result = await service.create(
      { name: 'My Directory', primaryLanguage: 'en' },
      scope,
    );

    expect(result.cover.titleLocalized.autoTranslatedLocales).toEqual([]);
    expect(result.header.textLocalized.autoTranslatedLocales).toEqual([]);
  });

  it('updates autoTranslatedLocales alongside values', async () => {
    const doc = createDirectoryDoc();
    mockPrintableDirectoryModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(doc),
    });

    const result = await service.update(
      '6ad0dcb938dccb2e7af9f9c1',
      {
        cover: {
          titleLocalized: {
            values: { en: 'Title', es: 'Título' },
            autoTranslatedLocales: ['es'],
          },
        },
      },
      scope,
    );

    expect(doc.cover.titleLocalized.values).toEqual({
      en: 'Title',
      es: 'Título',
    });
    expect(doc.cover.titleLocalized.autoTranslatedLocales).toEqual(['es']);
    expect(result.cover.titleLocalized.autoTranslatedLocales).toEqual(['es']);
  });

  it('preserves existing autoTranslatedLocales when values are updated without the list', async () => {
    const doc = createDirectoryDoc();
    doc.cover.titleLocalized = {
      values: { en: 'Title' },
      autoTranslatedLocales: ['es'],
    };
    mockPrintableDirectoryModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(doc),
    });

    const result = await service.update(
      '6ad0dcb938dccb2e7af9f9c1',
      {
        cover: {
          titleLocalized: { values: { en: 'Updated title' } },
        },
      },
      scope,
    );

    expect(doc.cover.titleLocalized.values).toEqual({ en: 'Updated title' });
    expect(doc.cover.titleLocalized.autoTranslatedLocales).toEqual(['es']);
    expect(result.cover.titleLocalized.autoTranslatedLocales).toEqual(['es']);
  });

  it('derives locales from all localized fields and includes primaryLanguage', async () => {
    const doc = createDirectoryDoc({
      primaryLanguage: 'en',
      cover: {
        titleLocalized: {
          values: { en: 'Title', es: 'Título' },
          autoTranslatedLocales: ['es'],
        },
        descriptionLocalized: { values: {}, autoTranslatedLocales: [] },
        primaryColor: null,
        layoutType: 'default',
        coverImageUrlFront: null,
        coverImageUrlBack: null,
      },
      sections: [
        {
          id: 'section-1',
          order: 0,
          headingLocalized: {
            values: { en: '', fr: 'Titre' },
            autoTranslatedLocales: [],
          },
          descriptionLocalized: { values: {}, autoTranslatedLocales: [] },
          maxResources: 10,
          sources: [],
        },
      ],
    });

    mockPrintableDirectoryModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(doc),
    });

    const result = await service.getById('6ad0dcb938dccb2e7af9f9c1', scope);

    expect(result.cover.titleLocalized.values).toEqual({
      en: 'Title',
      es: 'Título',
    });
    // Empty-string values are not counted; primaryLanguage is always included.
    expect(result.locales).toEqual(['en', 'es', 'fr']);
  });

  it('stores locales at creation, always including primaryLanguage', async () => {
    const doc = createDirectoryDoc();
    mockPrintableDirectoryModel.create.mockResolvedValue(doc);

    await service.create(
      { name: 'My Directory', primaryLanguage: 'es', locales: ['fr', ' en '] },
      scope,
    );

    expect(mockPrintableDirectoryModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ locales: ['en', 'es', 'fr'] }),
    );
  });

  it('defaults stored locales to the primary language', async () => {
    const doc = createDirectoryDoc();
    mockPrintableDirectoryModel.create.mockResolvedValue(doc);

    await service.create(
      { name: 'My Directory', primaryLanguage: 'en' },
      scope,
    );

    expect(mockPrintableDirectoryModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ locales: ['en'] }),
    );
  });

  it('updates locales and returns the stored list instead of deriving it', async () => {
    const doc = createDirectoryDoc({
      cover: {
        titleLocalized: {
          values: { en: 'Title', de: 'Titel' },
          autoTranslatedLocales: [],
        },
        descriptionLocalized: { values: {}, autoTranslatedLocales: [] },
        primaryColor: null,
        layoutType: 'default',
        coverImageUrlFront: null,
        coverImageUrlBack: null,
      },
    });
    mockPrintableDirectoryModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(doc),
    });

    const result = await service.update(
      '6ad0dcb938dccb2e7af9f9c1',
      { locales: ['es'] },
      scope,
    );

    expect(doc.locales).toEqual(['en', 'es']);
    // 'de' has content but isn't offered; 'es' is offered without content yet.
    expect(result.locales).toEqual(['en', 'es']);
  });

  it('stores one directory-level logo and clears it with an empty string', async () => {
    const doc = createDirectoryDoc();
    mockPrintableDirectoryModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(doc),
    });

    const withLogo = await service.update(
      '6ad0dcb938dccb2e7af9f9c1',
      { logoUrl: 'https://example.com/logo.png' },
      scope,
    );
    expect(withLogo.logoUrl).toBe('https://example.com/logo.png');

    const cleared = await service.update(
      '6ad0dcb938dccb2e7af9f9c1',
      { logoUrl: '' },
      scope,
    );
    expect(doc.logoUrl).toBeNull();
    expect(cleared.logoUrl).toBeNull();
  });

  it('updates section autoTranslatedLocales alongside values', async () => {
    const doc = createDirectoryDoc({
      sections: [
        {
          id: 'section-1',
          order: 0,
          headingLocalized: { values: { en: 'A' }, autoTranslatedLocales: [] },
          descriptionLocalized: {
            values: { en: 'Desc' },
            autoTranslatedLocales: [],
          },
          maxResources: 10,
          sources: [],
        },
      ],
    });

    mockPrintableDirectoryModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(doc),
    });

    const result = await service.updateSection(
      '6ad0dcb938dccb2e7af9f9c1',
      'section-1',
      {
        headingLocalized: {
          values: { en: 'A', es: 'A es' },
          autoTranslatedLocales: ['es'],
        },
      },
      scope,
    );

    expect(result.sections[0].headingLocalized.autoTranslatedLocales).toEqual([
      'es',
    ]);
  });

  it('throws ConflictException when creating a directory with a slug already used in the tenant', async () => {
    const duplicateError: any = new Error(
      'E11000 duplicate key error collection: printableDirectories index: tenantId_1_slug_1 dup key: { tenantId: "tenant-1", slug: "shelter-guide" }',
    );
    duplicateError.code = 11000;
    mockPrintableDirectoryModel.create.mockRejectedValue(duplicateError);

    await expect(
      service.create(
        {
          name: 'My Directory',
          primaryLanguage: 'en',
          slug: 'shelter-guide',
        },
        scope,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('throws ConflictException when updating a directory to a slug already used in the tenant', async () => {
    const doc = createDirectoryDoc();
    const duplicateError: any = new Error(
      'E11000 duplicate key error collection: printableDirectories index: tenantId_1_slug_1 dup key: { tenantId: "tenant-1", slug: "shelter-guide" }',
    );
    duplicateError.code = 11000;
    doc.save = jest.fn().mockRejectedValue(duplicateError);
    mockPrintableDirectoryModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(doc),
    });

    await expect(
      service.update(
        '6ad0dcb938dccb2e7af9f9c1',
        { slug: 'shelter-guide' },
        scope,
      ),
    ).rejects.toThrow(ConflictException);
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

    await expect(
      service.getById('6ad0dcb938dccb2e7af9f9c1', scope),
    ).rejects.toThrow(NotFoundException);
    expect(mockPrintableDirectoryModel.findOne).toHaveBeenCalledWith({
      _id: '6ad0dcb938dccb2e7af9f9c1',
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
      '6ad0dcb938dccb2e7af9f9c1',
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
        '6ad0dcb938dccb2e7af9f9c1',
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
      '6ad0dcb938dccb2e7af9f9c1',
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

  it('resolves section text in the requested locale, falling back to the primary language', async () => {
    const directory = createDirectoryDoc({
      primaryLanguage: 'es',
      sections: [
        {
          id: 'section-1',
          order: 0,
          headingLocalized: {
            values: { es: 'Encabezado', en: 'Heading', ko: '' },
          },
          descriptionLocalized: { values: { es: '', en: 'English only' } },
          maxResources: 10,
          sources: [],
        },
      ],
    });
    mockPrintableDirectoryModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(directory),
    });

    const english = await service.preview(
      '6ad0dcb938dccb2e7af9f9c1',
      'en',
      { 'x-tenant-id': scope.tenantId, 'accept-language': 'en' },
      scope,
    );
    expect(english.sections[0].resolvedHeading).toBe('Heading');
    expect(english.sections[0].resolvedDescription).toBe('English only');

    // A blank Korean heading falls back to Spanish (primary), not English;
    // with no primary description, there is none.
    const korean = await service.preview(
      '6ad0dcb938dccb2e7af9f9c1',
      'ko',
      { 'x-tenant-id': scope.tenantId, 'accept-language': 'ko' },
      scope,
    );
    expect(korean.sections[0].resolvedHeading).toBe('Encabezado');
    expect(korean.sections[0].resolvedDescription).toBe('');
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
      '6ad0dcb938dccb2e7af9f9c1',
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
      '6ad0dcb938dccb2e7af9f9c1',
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

  it('scopes a query source to its organization_id', async () => {
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
              type: 'query',
              query: {
                title: 'Food Lifeline',
                params: { query_type: 'text', organization_id: 'org-123' },
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
      '6ad0dcb938dccb2e7af9f9c1',
      'en',
      { 'x-tenant-id': scope.tenantId, 'accept-language': 'en' },
      scope,
    );

    expect(mockSearchService.searchResources).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ organization_id: 'org-123' }),
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
      '6ad0dcb938dccb2e7af9f9c1',
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

  it('continues preview when resource resolution reports errors but keeps the missing resource out of the result', async () => {
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

    const result = await service.preview(
      '6ad0dcb938dccb2e7af9f9c1',
      'en',
      { 'x-tenant-id': scope.tenantId, 'accept-language': 'en' },
      scope,
    );

    expect(result.sections[0].resources).toEqual([]);
  });

  describe('previewBySlug', () => {
    it('resolves preview for a private directory without any requesting user', async () => {
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
                resourceIds: ['resource-9'],
              },
            ],
          },
        ],
      });
      directory.accessPolicy = 'private';
      directory.slug = 'shelter-guide';

      mockPrintableDirectoryModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(directory),
      });

      mockResourceService.findManyByIds.mockResolvedValue({
        data: { 'resource-9': { _id: 'resource-9', displayName: 'R9' } },
        errors: [],
        meta: { requested: 1, successful: 1, failed: 0 },
      });

      const result = await service.previewBySlug(
        'shelter-guide',
        scope.tenantId,
        'en',
        { 'x-tenant-id': scope.tenantId, 'accept-language': 'en' },
      );

      expect(mockPrintableDirectoryModel.findOne).toHaveBeenCalledWith({
        tenantId: scope.tenantId,
        slug: 'shelter-guide',
      });
      expect(result.sections[0].resources.map((item) => item.id)).toEqual([
        'resource-9',
      ]);
    });

    it('throws NotFoundException when no directory matches the tenant/slug', async () => {
      mockPrintableDirectoryModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(
        service.previewBySlug('missing-slug', scope.tenantId, 'en', {
          'x-tenant-id': scope.tenantId,
          'accept-language': 'en',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('resolves favorites_list sources against the directory owner, not a requesting user', async () => {
      const directory = createDirectoryDoc({
        ownerUserId: 'owner-42',
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
      directory.slug = 'shelter-guide';

      mockPrintableDirectoryModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(directory),
      });

      mockFavoriteListModel.findOne.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ favorites: ['resource-9'] }),
        }),
      });

      mockResourceService.findManyByIds.mockResolvedValue({
        data: { 'resource-9': { _id: 'resource-9', displayName: 'R9' } },
        errors: [],
        meta: { requested: 1, successful: 1, failed: 0 },
      });

      await service.previewBySlug('shelter-guide', scope.tenantId, 'en', {
        'x-tenant-id': scope.tenantId,
        'accept-language': 'en',
      });

      expect(mockFavoriteListModel.findOne).toHaveBeenCalledWith({
        _id: 'fav-1',
        ownerId: 'owner-42',
        tenantId: scope.tenantId,
      });
    });
  });
});
