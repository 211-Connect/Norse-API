import { Test, TestingModule } from '@nestjs/testing';
import { FavoriteListController } from './favorite-list.controller';
import { FavoriteListService } from './favorite-list.service';
import { KeycloakAuthService } from 'src/auth/services/keycloak-auth.service';
import { PaginationDto } from './dto/pagination.dto';
import { SearchFavoriteListDto } from './dto/search-favorite-list.dto';
import { FavoriteListResponseDto } from './dto/favorite-list.response.dto';
import { NotFoundException } from '@nestjs/common';
import { Response } from 'express';

describe('FavoriteListController', () => {
  let controller: FavoriteListController;
  let service: FavoriteListService;

  const mockFavoriteListService = {
    findAll: jest.fn(),
    search: jest.fn(),
    purge: jest.fn(),
    syncLocalList: jest.fn(),
  };

  const mockKeycloakAuthService = {
    verifyToken: jest.fn(),
  };

  const mockUser = { id: 'user-123' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FavoriteListController],
      providers: [
        {
          provide: FavoriteListService,
          useValue: mockFavoriteListService,
        },
        {
          provide: KeycloakAuthService,
          useValue: mockKeycloakAuthService,
        },
      ],
    }).compile();

    controller = module.get<FavoriteListController>(FavoriteListController);
    service = module.get<FavoriteListService>(FavoriteListService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('should return paginated results with V2 structure', async () => {
      const pagination: PaginationDto = { page: 1, limit: 10 };
      const expectedResponse = {
        items: [],
        total: 1,
        page: 1,
      };

      mockFavoriteListService.findAll.mockResolvedValue(expectedResponse);

      const result = await controller.findAll(pagination, mockUser);

      expect(service.findAll).toHaveBeenCalledWith(pagination, {
        user: mockUser,
      });
      expect(result).toEqual(expectedResponse);
    });

    it('should delegate to search if search param is present', async () => {
      const pagination: PaginationDto = { page: 1, limit: 10, search: 'test' };
      const expectedResponse: FavoriteListResponseDto = {
        items: [],
        total: 1,
        page: 1,
      };

      jest.spyOn(service, 'search').mockResolvedValue(expectedResponse);
      mockFavoriteListService.findAll.mockImplementation(async (pag, opt) => {
        if (pag.search) return service.search({ name: pag.search }, pag, opt);
        return expectedResponse;
      });

      const result = await controller.findAll(pagination, mockUser);

      expect(service.findAll).toHaveBeenCalledWith(pagination, {
        user: mockUser,
      });
      expect(service.search).toHaveBeenCalledWith(
        { name: 'test' },
        pagination,
        { user: mockUser },
      );
      expect(result).toEqual(expectedResponse);
    });
  });

  describe('search', () => {
    it('should return paginated search results with V2 structure', async () => {
      const query: SearchFavoriteListDto = { name: 'test' };
      const pagination: PaginationDto = { page: 1, limit: 10 };
      const expectedResponse = {
        items: [],
        total: 1,
        page: 1,
      };

      mockFavoriteListService.search.mockResolvedValue(expectedResponse);

      const result = await controller.search(query, pagination, mockUser);

      expect(service.search).toHaveBeenCalledWith(query, pagination, {
        user: mockUser,
      });
      expect(result).toEqual(expectedResponse);
    });
  });

  describe('purge', () => {
    it('should call favoriteListService.purge with correct args', async () => {
      const listId = 'list-abc';
      const mockResult = { matchedCount: 1, modifiedCount: 1 };
      mockFavoriteListService.purge.mockResolvedValue(mockResult);

      const result = await controller.purge(listId, mockUser);

      expect(service.purge).toHaveBeenCalledWith(listId, { user: mockUser });
      expect(result).toEqual(mockResult);
    });

    it('should propagate NotFoundException from service when list not found', async () => {
      mockFavoriteListService.purge.mockRejectedValue(new NotFoundException());

      await expect(controller.purge('nonexistent', mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('syncLocalList', () => {
    const mockRequest = { tenantId: 'tenant-123' } as any;
    const mockResponse = {
      status: jest.fn(),
    } as unknown as Response;

    it('should return created list and set 201 when service creates a new list', async () => {
      const payload = { resourceIds: ['resource-2', 'resource-1'] };
      const createdList = {
        id: 'list-1',
        name: 'My New List',
        description: '',
        privacy: 'PRIVATE',
        ownerId: mockUser.id,
        favorites: ['resource-1', 'resource-2'],
      };

      mockFavoriteListService.syncLocalList.mockResolvedValue({
        created: true,
        favoriteList: createdList,
      });

      const result = await controller.syncLocalList(
        payload,
        mockUser,
        mockRequest,
        mockResponse,
      );

      expect(service.syncLocalList).toHaveBeenCalledWith(payload, {
        user: mockUser,
        tenantId: 'tenant-123',
      });
      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(result).toEqual(createdList);
    });

    it('should set 204 and return no body when identical list exists', async () => {
      mockFavoriteListService.syncLocalList.mockResolvedValue({
        created: false,
      });

      const result = await controller.syncLocalList(
        { resourceIds: ['resource-1'] },
        mockUser,
        mockRequest,
        mockResponse,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(204);
      expect(result).toBeUndefined();
    });
  });
});
