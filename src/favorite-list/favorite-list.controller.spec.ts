import { Test, TestingModule } from '@nestjs/testing';
import { FavoriteListController } from './favorite-list.controller';
import { FavoriteListService } from './favorite-list.service';

describe('FavoriteListController', () => {
  let controller: FavoriteListController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FavoriteListController],
      providers: [FavoriteListService],
    }).compile();

    controller = module.get<FavoriteListController>(FavoriteListController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
