import { Module } from '@nestjs/common';
import { CmsConfigModule } from 'src/cms-config/cms-config.module';
import { RequestCacheModule } from 'src/common/services/cache/request-cache.module';
import { MlBrokerModule } from 'src/ml-broker/ml-broker.module';
import { RegionServiceModule } from 'src/region/internal';
import { SharedElasticsearchModule } from 'src/common/providers/elasticsearch.module';
import { SearchModule } from '../../search/search.module';
import { SearchClassificationClient } from './search-classification.client';
import { V2SearchEnabledGuard } from './v2-search-enabled.guard';
import { V2SearchController } from './v2-search.controller';
import { V2SearchService } from './v2-search.service';

@Module({
  imports: [
    SearchModule,
    MlBrokerModule,
    CmsConfigModule,
    RegionServiceModule,
    RequestCacheModule,
    SharedElasticsearchModule,
  ],
  controllers: [V2SearchController],
  providers: [
    V2SearchService,
    SearchClassificationClient,
    V2SearchEnabledGuard,
  ],
})
export class V2SearchModule {}
