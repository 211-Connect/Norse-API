import { Module } from '@nestjs/common';
import { SharedElasticsearchModule } from 'src/common/providers/elasticsearch.module';
import { RegionController } from './region.controller';
import { RegionService } from './region.service';

/** RegionService alone, for modules that need it without mounting the routes. */
@Module({
  imports: [SharedElasticsearchModule],
  providers: [RegionService],
  exports: [RegionService],
})
export class RegionServiceModule {}

@Module({
  imports: [RegionServiceModule],
  controllers: [RegionController],
})
export class RegionInternalModule {}
