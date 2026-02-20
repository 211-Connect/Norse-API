import { Module } from '@nestjs/common';
import { FavoriteListService } from './favorite-list.service';
import { FavoriteListController } from './favorite-list.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Resource, ResourceSchema } from 'src/common/schemas/resource.schema';
import {
  FavoriteList,
  FavoriteListSchema,
} from 'src/common/schemas/favorite-list.schema';
import { CmsConfigModule } from 'src/cms-config/cms-config.module';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [
    AuthModule,
    CmsConfigModule,
    MongooseModule.forFeature([
      { name: FavoriteList.name, schema: FavoriteListSchema },
      { name: Resource.name, schema: ResourceSchema },
    ]),
  ],
  controllers: [FavoriteListController],
  providers: [FavoriteListService],
})
export class FavoriteListModule {}
