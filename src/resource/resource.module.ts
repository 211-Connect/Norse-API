import { Module } from '@nestjs/common';
import { ResourceService } from './resource.service';
import { ResourceController } from './resource.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Resource, ResourceSchema } from 'src/common/schemas/resource.schema';
import { Redirect, RedirectSchema } from 'src/common/schemas/redirect.schema';
import {
  ResourceTitleSnapshot,
  ResourceTitleSnapshotSchema,
} from 'src/common/schemas/resource-title-snapshot.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Resource.name, schema: ResourceSchema },
      { name: Redirect.name, schema: RedirectSchema },
      {
        name: ResourceTitleSnapshot.name,
        schema: ResourceTitleSnapshotSchema,
      },
    ]),
  ],
  controllers: [ResourceController],
  providers: [ResourceService],
  exports: [ResourceService],
})
export class ResourceModule {}
