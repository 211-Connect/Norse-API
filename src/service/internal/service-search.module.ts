import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SharedElasticsearchModule } from 'src/common/providers/elasticsearch.module';
import {
  SharingWithheldService,
  SharingWithheldServiceSchema,
  SharingWithheldVersion,
  SharingWithheldVersionSchema,
} from 'src/common/schemas/sharing-withholding.schema';
import { RegionServiceModule } from '../../region/internal';
import { ServiceSearchController } from './service-search.controller';
import { ServiceSearchService } from './service-search.service';
import { WithholdingService } from './withholding.service';
import { TaxonomyNameService } from './taxonomy-name.service';

@Module({
  imports: [
    SharedElasticsearchModule,
    RegionServiceModule,
    MongooseModule.forFeature([
      {
        name: SharingWithheldService.name,
        schema: SharingWithheldServiceSchema,
      },
      {
        name: SharingWithheldVersion.name,
        schema: SharingWithheldVersionSchema,
      },
    ]),
  ],
  controllers: [ServiceSearchController],
  providers: [ServiceSearchService, WithholdingService, TaxonomyNameService],
})
export class ServiceSearchInternalModule {}
