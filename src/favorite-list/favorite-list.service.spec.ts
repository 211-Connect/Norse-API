import { Test, TestingModule } from '@nestjs/testing';
import { FavoriteListService } from './favorite-list.service';

describe('FavoriteListService', () => {
  let service: FavoriteListService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FavoriteListService],
    }).compile();

    service = module.get<FavoriteListService>(FavoriteListService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
