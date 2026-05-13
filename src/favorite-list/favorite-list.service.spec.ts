import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { FavoriteListService } from './favorite-list.service';
import { FavoriteList } from 'src/common/schemas/favorite-list.schema';

describe('FavoriteListService', () => {
  let service: FavoriteListService;

  const mockFavoriteListModel = {
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    countDocuments: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FavoriteListService,
        {
          provide: getModelToken(FavoriteList.name),
          useValue: mockFavoriteListModel,
        },
      ],
    }).compile();

    service = module.get<FavoriteListService>(FavoriteListService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
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
