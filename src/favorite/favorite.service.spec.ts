import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { FavoriteService } from './favorite.service';
import { FavoriteList } from 'src/common/schemas/favorite-list.schema';

describe('FavoriteService', () => {
  let service: FavoriteService;

  const mockSave = jest.fn();
  const mockFindOne = jest.fn();
  const mockFavoriteListModel = {
    findOne: mockFindOne,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FavoriteService,
        {
          provide: getModelToken(FavoriteList.name),
          useValue: mockFavoriteListModel,
        },
      ],
    }).compile();

    service = module.get<FavoriteService>(FavoriteService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should append a new favorite and save the list', async () => {
      const favoriteList: any = {
        favorites: ['resource-2'],
        save: mockSave,
      };
      mockFindOne.mockResolvedValue(favoriteList);
      mockSave.mockResolvedValue({
        ...favoriteList,
        favorites: ['resource-2', 'resource-1'],
      });

      const result = await service.create(
        { favoriteListId: 'list-1', resourceId: 'resource-1' },
        { user: { id: 'user-1' } },
      );

      expect(favoriteList.favorites).toEqual(['resource-2', 'resource-1']);
      expect(result).toEqual({
        ...favoriteList,
        favorites: ['resource-2', 'resource-1'],
      });
    });

    it('should throw ConflictException when favorite already exists', async () => {
      mockFindOne.mockResolvedValue({
        favorites: ['resource-1'],
      });

      await expect(
        service.create(
          { favoriteListId: 'list-1', resourceId: 'resource-1' },
          { user: { id: 'user-1' } },
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException when list does not exist', async () => {
      mockFindOne.mockResolvedValue(null);

      await expect(
        service.create(
          { favoriteListId: 'list-1', resourceId: 'resource-1' },
          { user: { id: 'user-1' } },
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
