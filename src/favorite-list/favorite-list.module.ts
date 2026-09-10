import { Module } from '@nestjs/common';
import { FavoriteListService } from './favorite-list.service';
import { FavoriteListController } from './favorite-list.controller';
import { MongooseModule } from '@nestjs/mongoose';
import {
  FavoriteList,
  FavoriteListSchema,
} from 'src/common/schemas/favorite-list.schema';
import { CmsConfigModule } from 'src/cms-config/cms-config.module';
import { AuthModule } from 'src/auth/auth.module';
import { ResourceModule } from 'src/resource/resource.module';

@Module({
  imports: [
    AuthModule,
    CmsConfigModule,
    ResourceModule,
    MongooseModule.forFeature([
      { name: FavoriteList.name, schema: FavoriteListSchema },
    ]),
  ],
  controllers: [FavoriteListController],
  providers: [FavoriteListService],
  exports: [FavoriteListService],
})
export class FavoriteListModule {}
