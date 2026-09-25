import { Module } from '@nestjs/common';
import { SharedElasticsearchModule } from 'src/common/providers/elasticsearch.module';
import { ServiceSearchController } from './service-search.controller';
import { ServiceSearchService } from './service-search.service';

@Module({
  imports: [SharedElasticsearchModule],
  controllers: [ServiceSearchController],
  providers: [ServiceSearchService],
})
export class ServiceSearchInternalModule {}
