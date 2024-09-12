import { Module } from '@nestjs/common';
import { FavoriteService } from './favorite.service';
import { FavoriteController } from './favorite.controller';
import { MongooseModule } from '@nestjs/mongoose';
import {
  FavoriteList,
  FavoriteListSchema,
} from 'src/common/schemas/favorite-list.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FavoriteList.name, schema: FavoriteListSchema },
    ]),
  ],
  controllers: [FavoriteController],
  providers: [FavoriteService],
})
export class FavoriteModule {}
