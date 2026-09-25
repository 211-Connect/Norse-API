import { Module } from '@nestjs/common';
import { SharedElasticsearchModule } from 'src/common/providers/elasticsearch.module';
import { RegionServiceModule } from '../../region/internal';
import { ServiceSearchController } from './service-search.controller';
import { ServiceSearchService } from './service-search.service';

@Module({
  imports: [SharedElasticsearchModule, RegionServiceModule],
  controllers: [ServiceSearchController],
  providers: [ServiceSearchService],
})
export class ServiceSearchInternalModule {}
