import { Module } from '@nestjs/common';
import { CmsConfigModule } from 'src/cms-config/cms-config.module';
import { MlBrokerModule } from 'src/ml-broker/ml-broker.module';
import { SearchModule } from '../../search/search.module';
import { SearchClassificationClient } from './search-classification.client';
import { V2SearchEnabledGuard } from './v2-search-enabled.guard';
import { V2SearchController } from './v2-search.controller';
import { V2SearchService } from './v2-search.service';

@Module({
  imports: [SearchModule, MlBrokerModule, CmsConfigModule],
  controllers: [V2SearchController],
  providers: [
    V2SearchService,
    SearchClassificationClient,
    V2SearchEnabledGuard,
  ],
})
export class V2SearchModule {}
