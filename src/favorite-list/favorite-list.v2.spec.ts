import { Test, TestingModule } from '@nestjs/testing';
import { FavoriteListController } from './favorite-list.controller';
import { FavoriteListService } from './favorite-list.service';
import { PaginationDto } from './dto/pagination.dto';
import { SearchFavoriteListDto } from './dto/search-favorite-list.dto';
import { FavoriteListV2ResponseDto } from './dto/favorite-list-v2.response.dto';

describe('FavoriteListController V2', () => {
  let controller: FavoriteListController;
  let service: FavoriteListService;

  const mockFavoriteListService = {
    findAllV2: jest.fn(),
    searchV2: jest.fn(),
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

  describe('findAllV2', () => {
    it('should return paginated results with V2 structure', async () => {
      const pagination: PaginationDto = { page: 1, limit: 10 };
      const expectedResponse = {
        search: {
          hits: {
            total: { value: 1, relation: 'eq' },
            hits: [],
          },
        },
      };

      mockFavoriteListService.findAllV2.mockResolvedValue(expectedResponse);

      const result = await controller.findAllV2(pagination, mockUser);

      expect(service.findAllV2).toHaveBeenCalledWith(pagination, {
        user: mockUser,
      });
      expect(result).toEqual(expectedResponse);
    });

    it('should delegate to searchV2 if search param is present', async () => {
      const pagination: PaginationDto = { page: 1, limit: 10, search: 'test' };
      const expectedResponse: FavoriteListV2ResponseDto = {
        search: {
          took: 0,
          timed_out: false,
          _shards: {
            total: 1,
            successful: 1,
            skipped: 0,
            failed: 0,
          },
          hits: {
            total: { value: 1, relation: 'eq' },
            max_score: null,
            hits: [],
          },
        },
      };

      // Mock implementation to verify delegation
      jest.spyOn(service, 'searchV2').mockResolvedValue(expectedResponse);
      mockFavoriteListService.findAllV2.mockImplementation(async (pag, opt) => {
        if (pag.search) return service.searchV2({ name: pag.search }, pag, opt);
        return expectedResponse;
      });

      const result = await controller.findAllV2(pagination, mockUser);

      expect(service.findAllV2).toHaveBeenCalledWith(pagination, {
        user: mockUser,
      });
      expect(service.searchV2).toHaveBeenCalledWith(
        { name: 'test' },
        pagination,
        { user: mockUser },
      );
      expect(result).toEqual(expectedResponse);
    });
  });

  describe('searchV2', () => {
    it('should return paginated search results with V2 structure', async () => {
      const query: SearchFavoriteListDto = { name: 'test' };
      const pagination: PaginationDto = { page: 1, limit: 10 };
      const expectedResponse = {
        search: {
          hits: {
            total: { value: 1, relation: 'eq' },
            hits: [],
          },
        },
      };

      mockFavoriteListService.searchV2.mockResolvedValue(expectedResponse);

      const result = await controller.searchV2(query, pagination, mockUser);

      expect(service.searchV2).toHaveBeenCalledWith(query, pagination, {
        user: mockUser,
      });
      expect(result).toEqual(expectedResponse);
    });
  });
});
