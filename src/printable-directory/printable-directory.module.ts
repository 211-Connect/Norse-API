import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  FavoriteList,
  FavoriteListSchema,
} from 'src/common/schemas/favorite-list.schema';
import {
  PrintableDirectory,
  PrintableDirectorySchema,
} from 'src/common/schemas/printable-directory.schema';
import { AuthModule } from 'src/auth/auth.module';
import { FavoriteListModule } from 'src/favorite-list/favorite-list.module';
import { ResourceModule } from 'src/resource/resource.module';
import { SearchModule } from 'src/search/search.module';
import { PrintableDirectoryController } from './printable-directory.controller';
import { PrintableDirectoryService } from './printable-directory.service';

@Module({
  imports: [
    AuthModule,
    FavoriteListModule,
    SearchModule,
    ResourceModule,
    MongooseModule.forFeature([
      { name: PrintableDirectory.name, schema: PrintableDirectorySchema },
      { name: FavoriteList.name, schema: FavoriteListSchema },
    ]),
  ],
  controllers: [PrintableDirectoryController],
  providers: [PrintableDirectoryService],
})
export class PrintableDirectoryModule {}
