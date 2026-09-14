import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { FavoriteListService } from './favorite-list.service';
import { FavoriteList } from 'src/common/schemas/favorite-list.schema';
import { ResourceService } from 'src/resource/resource.service';

const mockDoc = (id: string, overrides: Record<string, unknown> = {}) => ({
  _id: { toString: () => id },
  name: 'My List',
  description: '',
  privacy: 'PRIVATE',
  ownerId: 'user-123',
  favorites: [],
  ...overrides,
});

const mockTransformedResource = (id: string): Record<string, unknown> => ({
  _id: `mongo-${id}`,
  serviceAtLocationId: id,
  translation: { locale: 'en', displayName: `Resource ${id}` },
  facetsEn: [],
});

describe('FavoriteListService', () => {
  let service: FavoriteListService;
  const aggregateExec = jest.fn();
  const mockAggregate = jest.fn(() => ({ exec: aggregateExec }));
  const findOneExec = jest.fn();
  const countDocumentsExec = jest.fn();

  const mockFavoriteListModel = {
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(() => ({ exec: findOneExec })),
    findById: jest.fn(),
    aggregate: mockAggregate,
    countDocuments: jest.fn(() => ({ exec: countDocumentsExec })),
    create: jest.fn(),
  };

  const mockResourceService = {
    findManyByIds: jest.fn(),
  };

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FavoriteListService,
        {
          provide: getModelToken(FavoriteList.name),
          useValue: mockFavoriteListModel,
        },
        {
          provide: ResourceService,
          useValue: mockResourceService,
        },
      ],
    }).compile();

    service = module.get<FavoriteListService>(FavoriteListService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findSummariesByIds', () => {
    it('should return an empty array when no IDs are requested', async () => {
      const result = await service.findSummariesByIds([]);

      expect(result).toEqual([]);
      expect(mockFavoriteListModel.find).not.toHaveBeenCalled();
    });

    it('should return id, name and favorite count for the requested lists', async () => {
      const queryExec = jest
        .fn()
        .mockResolvedValue([
          mockDoc('list-1', { name: 'List One', favorites: ['a', 'b'] }),
          mockDoc('list-2', { name: 'List Two', favorites: ['c'] }),
        ]);
      mockFavoriteListModel.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: queryExec }),
      });

      const result = await service.findSummariesByIds(['list-1', 'list-2']);

      expect(mockFavoriteListModel.find).toHaveBeenCalledWith(
        { _id: { $in: ['list-1', 'list-2'] } },
        { _id: 1, name: 1, favorites: 1 },
      );
      expect(result).toEqual([
        { id: 'list-1', name: 'List One', count: 2 },
        { id: 'list-2', name: 'List Two', count: 1 },
      ]);
    });

    it('should scope summaries to the provided tenant', async () => {
      const queryExec = jest.fn().mockResolvedValue([]);
      mockFavoriteListModel.find.mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: queryExec }),
      });

      await service.findSummariesByIds(['list-1'], { tenantId: 'tenant-1' });

      expect(mockFavoriteListModel.find).toHaveBeenCalledWith(
        { _id: { $in: ['list-1'] }, tenantId: 'tenant-1' },
        { _id: 1, name: 1, favorites: 1 },
      );
    });
  });

  describe('create', () => {
    const user = { id: 'user-123' };
    const tenantId = 'tenant-123';

    it('should create a private favorite list with the provided data', async () => {
      const createDto = {
        name: 'New List',
        description: 'A description',
        public: false,
      };
      const savedList = mockDoc('list-1', {
        name: 'New List',
        description: 'A description',
        privacy: 'PRIVATE',
        ownerId: user.id,
        tenantId,
        favorites: [],
      });
      mockFavoriteListModel.create.mockResolvedValue(savedList);

      const result = await service.create(createDto, { user, tenantId });

      expect(mockFavoriteListModel.create).toHaveBeenCalledWith({
        name: 'New List',
        description: 'A description',
        privacy: 'PRIVATE',
        ownerId: user.id,
        tenantId,
        favorites: [],
      });
      expect(result).toEqual(savedList);
    });

    it('should create a public favorite list when public is true', async () => {
      const createDto = {
        name: 'Public List',
        description: '',
        public: true,
      };
      mockFavoriteListModel.create.mockResolvedValue(
        mockDoc('list-2', {
          name: 'Public List',
          description: '',
          privacy: 'PUBLIC',
          ownerId: user.id,
          favorites: [],
        }),
      );

      await service.create(createDto, { user });

      expect(mockFavoriteListModel.create).toHaveBeenCalledWith({
        name: 'Public List',
        description: '',
        privacy: 'PUBLIC',
        ownerId: user.id,
        favorites: [],
      });
    });

    it('should default missing description and privacy', async () => {
      const createDto = { name: 'Minimal List' } as any;
      mockFavoriteListModel.create.mockResolvedValue(mockDoc('list-3'));

      await service.create(createDto, { user });

      expect(mockFavoriteListModel.create).toHaveBeenCalledWith({
        name: 'Minimal List',
        description: '',
        privacy: 'PRIVATE',
        ownerId: user.id,
        favorites: [],
      });
    });

    it('should rethrow and log creation errors', async () => {
      const error = new Error('database failure');
      mockFavoriteListModel.create.mockRejectedValue(error);

      await expect(
        service.create(
          { name: 'Bad List', description: '', public: false },
          { user },
        ),
      ).rejects.toThrow(error);
    });
  });

  describe('syncLocalList', () => {
    const user = { id: 'user-123' };
    const tenantId = 'tenant-123';

    it('should return created false when matching list already exists regardless of order', async () => {
      aggregateExec.mockResolvedValue([
        {
          _id: 'existing-list',
          name: 'Existing list',
          description: '',
          privacy: 'PRIVATE',
          ownerId: user.id,
          favorites: ['resource-1', 'resource-2'],
        },
      ]);

      const result = await service.syncLocalList(
        { resourceIds: ['resource-2', 'resource-1'] },
        { user, tenantId },
      );

      expect(mockFavoriteListModel.aggregate).toHaveBeenCalledWith([
        { $match: { ownerId: user.id, tenantId } },
        {
          $project: {
            name: 1,
            description: 1,
            privacy: 1,
            ownerId: 1,
            favorites: { $ifNull: ['$favorites', []] },
          },
        },
        {
          $match: {
            $expr: {
              $eq: [{ $size: '$favorites' }, 2],
            },
          },
        },
      ]);
      expect(mockFavoriteListModel.create).not.toHaveBeenCalled();
      expect(result).toEqual({ created: false });
    });

    it('should create a new favorite list when no exact match exists', async () => {
      aggregateExec.mockResolvedValue([]);
      mockFavoriteListModel.create.mockResolvedValue({
        _id: 'new-list-id',
        name: 'My New List',
        description: '',
        privacy: 'PRIVATE',
        ownerId: user.id,
        favorites: ['resource-1', 'resource-2'],
      });

      const result = await service.syncLocalList(
        { resourceIds: ['resource-2', 'resource-1', 'resource-1'] },
        { user, tenantId },
      );

      expect(mockFavoriteListModel.create).toHaveBeenCalledWith({
        name: 'My New List',
        description: '',
        privacy: 'PRIVATE',
        ownerId: user.id,
        tenantId,
        favorites: ['resource-1', 'resource-2'],
      });
      expect(result).toEqual({
        created: true,
        favoriteList: {
          id: 'new-list-id',
          name: 'My New List',
          description: '',
          privacy: 'PRIVATE',
          ownerId: user.id,
          favorites: ['resource-1', 'resource-2'],
        },
      });
    });

    it('should reject requests without any effective resource IDs', async () => {
      await expect(
        service.syncLocalList(
          { resourceIds: [' ', '   '] },
          { user, tenantId },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll', () => {
    const user = { id: 'user-123' };

    const createFindChain = (data: unknown[]) => ({
      select: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(data),
    });

    it('should return paginated lists for the user', async () => {
      const data = [
        mockDoc('list-1', { name: 'List One' }),
        mockDoc('list-2', { name: 'List Two' }),
      ];
      mockFavoriteListModel.find.mockReturnValue(createFindChain(data));
      countDocumentsExec.mockResolvedValue(5);

      const result = await service.findAll({ page: 2, limit: 10 }, { user });

      expect(mockFavoriteListModel.find).toHaveBeenCalledWith({
        ownerId: user.id,
      });
      expect(result).toEqual({
        total: 5,
        page: 2,
        items: [
          {
            id: 'list-1',
            name: 'List One',
            description: '',
            privacy: 'PRIVATE',
            ownerId: 'user-123',
          },
          {
            id: 'list-2',
            name: 'List Two',
            description: '',
            privacy: 'PRIVATE',
            ownerId: 'user-123',
          },
        ],
      });
    });

    it('should include containsResource when resource_id is provided', async () => {
      const data = [
        mockDoc('list-1', { favorites: ['resource-1', 'resource-2'] }),
        mockDoc('list-2', { favorites: ['resource-3'] }),
      ];
      mockFavoriteListModel.find.mockReturnValue(createFindChain(data));
      countDocumentsExec.mockResolvedValue(2);

      const result = await service.findAll(
        { page: 1, limit: 10, resource_id: 'resource-1' },
        { user },
      );

      expect(result.items[0].containsResource).toBe(true);
      expect(result.items[1].containsResource).toBe(false);
    });

    it('should delegate to search when a search term is provided', async () => {
      const searchResponse = {
        total: 1,
        page: 1,
        items: [mockDoc('list-1')],
      };
      jest.spyOn(service, 'search').mockResolvedValue(searchResponse as any);

      const result = await service.findAll(
        { page: 1, limit: 10, search: 'vacation' },
        { user },
      );

      expect(service.search).toHaveBeenCalledWith(
        { name: 'vacation' },
        { page: 1, limit: 10, search: 'vacation' },
        { user },
      );
      expect(result).toEqual(searchResponse);
    });
  });

  describe('search', () => {
    const user = { id: 'user-123' };

    const createFindChain = (data: unknown[]) => ({
      select: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(data),
    });

    it('should search by name using a case-insensitive regex', async () => {
      const data = [mockDoc('list-1', { name: 'Vacation Plans' })];
      mockFavoriteListModel.find.mockReturnValue(createFindChain(data));
      countDocumentsExec.mockResolvedValue(1);

      const result = await service.search(
        { name: 'vacation' },
        { page: 1, limit: 10 },
        { user },
      );

      expect(mockFavoriteListModel.find).toHaveBeenCalledWith({
        ownerId: user.id,
        name: { $regex: 'vacation', $options: 'i' },
      });
      expect(result.items[0].name).toBe('Vacation Plans');
    });

    it('should escape regex special characters in the name', async () => {
      mockFavoriteListModel.find.mockReturnValue(createFindChain([]));
      countDocumentsExec.mockResolvedValue(0);

      await service.search(
        { name: 'test+name' },
        { page: 1, limit: 10 },
        { user },
      );

      expect(mockFavoriteListModel.find).toHaveBeenCalledWith({
        ownerId: user.id,
        name: { $regex: 'test\\+name', $options: 'i' },
      });
    });

    it('should exclude lists that contain the excluded resource', async () => {
      mockFavoriteListModel.find.mockReturnValue(createFindChain([]));
      countDocumentsExec.mockResolvedValue(0);

      await service.search(
        { exclude: 'resource-1' },
        { page: 1, limit: 10 },
        { user },
      );

      expect(mockFavoriteListModel.find).toHaveBeenCalledWith({
        ownerId: user.id,
        favorites: { $nin: ['resource-1'] },
      });
    });

    it('should combine name and exclude filters', async () => {
      mockFavoriteListModel.find.mockReturnValue(createFindChain([]));
      countDocumentsExec.mockResolvedValue(0);

      await service.search(
        { name: 'list', exclude: 'resource-1' },
        { page: 1, limit: 10 },
        { user },
      );

      expect(mockFavoriteListModel.find).toHaveBeenCalledWith({
        ownerId: user.id,
        favorites: { $nin: ['resource-1'] },
        name: { $regex: 'list', $options: 'i' },
      });
    });
  });

  describe('findOne', () => {
    const headers = {
      'x-tenant-id': '00000000-0000-0000-0000-000000000001',
      'accept-language': 'en',
    } as any;

    it('should return favorite list details with resolved resources', async () => {
      const list = mockDoc('list-1', {
        name: 'My List',
        favorites: ['resource-1', 'resource-2'],
      });
      findOneExec.mockResolvedValue(list);
      mockResourceService.findManyByIds.mockResolvedValue({
        data: {
          'resource-1': mockTransformedResource('resource-1'),
          'resource-2': mockTransformedResource('resource-2'),
        },
        errors: [],
        meta: { requested: 2, successful: 2, failed: 0 },
      });

      const result = await service.findOne('list-1', headers);

      expect(mockFavoriteListModel.findOne).toHaveBeenCalledWith({
        _id: 'list-1',
        tenantId: headers['x-tenant-id'],
      });
      expect(mockResourceService.findManyByIds).toHaveBeenCalledWith(
        ['resource-1', 'resource-2'],
        { headers },
      );
      expect(result).toMatchObject({
        id: 'list-1',
        name: 'My List',
        favorites: [
          mockTransformedResource('resource-1'),
          mockTransformedResource('resource-2'),
        ],
      });
    });

    it('should preserve the requested resource order', async () => {
      const list = mockDoc('list-1', {
        favorites: ['resource-2', 'resource-1'],
      });
      findOneExec.mockResolvedValue(list);
      mockResourceService.findManyByIds.mockResolvedValue({
        data: {
          'resource-1': mockTransformedResource('resource-1'),
          'resource-2': mockTransformedResource('resource-2'),
        },
        errors: [],
        meta: { requested: 2, successful: 2, failed: 0 },
      });

      const result = await service.findOne('list-1', headers);

      expect(result.favorites.map((r: any) => r.serviceAtLocationId)).toEqual([
        'resource-2',
        'resource-1',
      ]);
    });

    it('should fall back to a list without tenant when tenant-scoped lookup fails', async () => {
      const list = mockDoc('list-1', { favorites: [] });
      findOneExec.mockResolvedValueOnce(null).mockResolvedValueOnce(list);

      const result = await service.findOne('list-1', headers);

      expect(mockFavoriteListModel.findOne).toHaveBeenNthCalledWith(1, {
        _id: 'list-1',
        tenantId: headers['x-tenant-id'],
      });
      expect(mockFavoriteListModel.findOne).toHaveBeenNthCalledWith(2, {
        _id: 'list-1',
      });
      expect(result.id).toBe('list-1');
    });

    it('should throw NotFoundException when the list does not exist', async () => {
      findOneExec.mockResolvedValue(null);

      await expect(service.findOne('missing', headers)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should drop unresolved resources and log a warning', async () => {
      const list = mockDoc('list-1', {
        favorites: ['resource-1', 'missing-resource'],
      });
      findOneExec.mockResolvedValue(list);
      mockResourceService.findManyByIds.mockResolvedValue({
        data: { 'resource-1': mockTransformedResource('resource-1') },
        errors: [
          {
            id: 'missing-resource',
            reason: 'Resource not found',
            statusCode: 404,
          },
        ],
        meta: { requested: 2, successful: 1, failed: 1 },
      });

      const result = await service.findOne('list-1', headers);

      expect(result.favorites).toHaveLength(1);
      expect(result.favorites[0]).toMatchObject(
        mockTransformedResource('resource-1'),
      );
    });

    it('should return an empty favorites array when the list has no favorites', async () => {
      const list = mockDoc('list-1', { favorites: [] });
      findOneExec.mockResolvedValue(list);

      const result = await service.findOne('list-1', headers);

      expect(mockResourceService.findManyByIds).not.toHaveBeenCalled();
      expect(result.favorites).toEqual([]);
    });
  });

  describe('update', () => {
    const user = { id: 'user-123' };
    const listId = 'list-abc';

    it('should update only the owned favorite list', async () => {
      mockFavoriteListModel.updateOne.mockResolvedValue({
        matchedCount: 1,
        modifiedCount: 1,
      });

      const result = await service.update(
        listId,
        { name: 'new name', description: 'new description', public: true },
        { user },
      );

      expect(mockFavoriteListModel.updateOne).toHaveBeenCalledWith(
        { _id: listId, ownerId: user.id },
        {
          name: 'new name',
          description: 'new description',
          privacy: 'PUBLIC',
        },
      );
      expect(result).toEqual({ matchedCount: 1, modifiedCount: 1 });
    });

    it('should set privacy to PRIVATE when public is false', async () => {
      mockFavoriteListModel.updateOne.mockResolvedValue({
        matchedCount: 1,
        modifiedCount: 1,
      });

      await service.update(
        listId,
        { name: 'new name', description: 'new description', public: false },
        { user },
      );

      expect(mockFavoriteListModel.updateOne).toHaveBeenCalledWith(
        { _id: listId, ownerId: user.id },
        {
          name: 'new name',
          description: 'new description',
          privacy: 'PRIVATE',
        },
      );
    });

    it('should throw NotFoundException when user does not own the list', async () => {
      mockFavoriteListModel.updateOne.mockResolvedValue({ matchedCount: 0 });

      await expect(
        service.update(
          listId,
          { name: 'new name', description: undefined, public: undefined },
          { user },
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('purge', () => {
    const user = { id: 'user-123' };
    const listId = 'list-abc';

    it('should clear favorites array when list belongs to user', async () => {
      mockFavoriteListModel.updateOne.mockResolvedValue({
        matchedCount: 1,
        modifiedCount: 1,
      });

      const result = await service.purge(listId, { user });

      expect(mockFavoriteListModel.updateOne).toHaveBeenCalledWith(
        { _id: listId, ownerId: user.id },
        { $set: { favorites: [] } },
      );
      expect(result.matchedCount).toBe(1);
    });

    it('should throw NotFoundException when list not found or not owned by user', async () => {
      mockFavoriteListModel.updateOne.mockResolvedValue({ matchedCount: 0 });

      await expect(service.purge(listId, { user })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    const user = { id: 'user-123' };
    const listId = 'list-abc';

    it('should delete only the owned favorite list', async () => {
      mockFavoriteListModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

      const result = await service.remove(listId, { user });

      expect(mockFavoriteListModel.deleteOne).toHaveBeenCalledWith({
        _id: listId,
        ownerId: user.id,
      });
      expect(result).toEqual({ deletedCount: 1 });
    });

    it('should throw NotFoundException when user does not own the list', async () => {
      mockFavoriteListModel.deleteOne.mockResolvedValue({ deletedCount: 0 });

      await expect(service.remove(listId, { user })).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
