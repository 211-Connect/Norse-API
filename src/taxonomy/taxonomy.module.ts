import { Module } from '@nestjs/common';
import { TaxonomyService } from './taxonomy.service';
import { TaxonomyController } from './taxonomy.controller';
import { SharedElasticsearchModule } from 'src/common/providers/elasticsearch.module';

@Module({
  controllers: [TaxonomyController],
  providers: [TaxonomyService],
  imports: [SharedElasticsearchModule],
})
export class TaxonomyModule {}
