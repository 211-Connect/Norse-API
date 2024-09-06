import { Module } from '@nestjs/common';
import { FavoriteListService } from './favorite-list.service';
import { FavoriteListController } from './favorite-list.controller';

@Module({
  controllers: [FavoriteListController],
  providers: [FavoriteListService],
})
export class FavoriteListModule {}
