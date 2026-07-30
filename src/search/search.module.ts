import { Module } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { CmsConfigModule } from 'src/cms-config/cms-config.module';
import { HybridSearchService } from './hybrid-search.service';
import { AiSearchService } from './ai-search.service';
import { RequestCacheModule } from 'src/common/services/cache/request-cache.module';
import { SharedElasticsearchModule } from 'src/common/providers/elasticsearch.module';

@Module({
  controllers: [SearchController],
  providers: [SearchService, HybridSearchService, AiSearchService],
  exports: [SearchService],
  imports: [CmsConfigModule, RequestCacheModule, SharedElasticsearchModule],
})
export class SearchModule {}
