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
import {
  PrintableDirectoryDelivery,
  PrintableDirectoryDeliverySchema,
} from 'src/common/schemas/printable-directory-delivery.schema';
import { AuthModule } from 'src/auth/auth.module';
import { FavoriteListModule } from 'src/favorite-list/favorite-list.module';
import { ResourceModule } from 'src/resource/resource.module';
import { SearchModule } from 'src/search/search.module';
import { PrintableDirectoryController } from './printable-directory.controller';
import { PrintableDirectoryPublicController } from './printable-directory-public.controller';
import { PrintableDirectoryService } from './printable-directory.service';
import { PrintableDirectoryDeliveryController } from './printable-directory-delivery.controller';
import { PrintableDirectoryDeliveryInternalController } from './printable-directory-delivery-internal.controller';
import { PrintableDirectoryDeliveryService } from './printable-directory-delivery.service';

@Module({
  imports: [
    AuthModule,
    FavoriteListModule,
    SearchModule,
    ResourceModule,
    MongooseModule.forFeature([
      { name: PrintableDirectory.name, schema: PrintableDirectorySchema },
      { name: FavoriteList.name, schema: FavoriteListSchema },
      {
        name: PrintableDirectoryDelivery.name,
        schema: PrintableDirectoryDeliverySchema,
      },
    ]),
  ],
  controllers: [
    PrintableDirectoryController,
    PrintableDirectoryPublicController,
    PrintableDirectoryDeliveryController,
    PrintableDirectoryDeliveryInternalController,
  ],
  providers: [PrintableDirectoryService, PrintableDirectoryDeliveryService],
})
export class PrintableDirectoryModule {}
