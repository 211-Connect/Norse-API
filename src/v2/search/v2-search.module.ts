import { Module } from '@nestjs/common';
import { CmsConfigModule } from 'src/cms-config/cms-config.module';
import { RequestCacheModule } from 'src/common/services/cache/request-cache.module';
import { MlBrokerModule } from 'src/ml-broker/ml-broker.module';
import { RegionServiceModule } from 'src/region/internal';
import { SearchModule } from '../../search/search.module';
import { SearchClassificationClient } from './search-classification.client';
import { V2SearchController } from './v2-search.controller';
import { V2SearchService } from './v2-search.service';

@Module({
  imports: [
    SearchModule,
    MlBrokerModule,
    CmsConfigModule,
    RegionServiceModule,
    RequestCacheModule,
  ],
  controllers: [V2SearchController],
  providers: [V2SearchService, SearchClassificationClient],
})
export class V2SearchModule {}
