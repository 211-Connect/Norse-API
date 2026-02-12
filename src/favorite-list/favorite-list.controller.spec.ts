import { Test, TestingModule } from '@nestjs/testing';
import { FavoriteListController } from './favorite-list.controller';
import { FavoriteListService } from './favorite-list.service';
import { PaginationDto } from './dto/pagination.dto';
import { SearchFavoriteListDto } from './dto/search-favorite-list.dto';
import { FavoriteListResponseDto } from './dto/favorite-list.response.dto';

describe('FavoriteListController', () => {
  let controller: FavoriteListController;
  let service: FavoriteListService;

  const mockFavoriteListService = {
    findAll: jest.fn(),
    search: jest.fn(),
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

      // Mock implementation to verify delegation
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
});
