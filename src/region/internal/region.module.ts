import { Module } from '@nestjs/common';
import { SharedElasticsearchModule } from 'src/common/providers/elasticsearch.module';
import { RegionController } from './region.controller';
import { RegionService } from './region.service';

@Module({
  imports: [SharedElasticsearchModule],
  controllers: [RegionController],
  providers: [RegionService],
})
export class RegionInternalModule {}
