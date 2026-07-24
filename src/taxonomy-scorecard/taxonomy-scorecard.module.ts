import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  TaxonomyScorecard,
  TaxonomyScorecardSchema,
} from 'src/common/schemas/taxonomy-scorecard.schema';
import { TaxonomyScorecardController } from './taxonomy-scorecard.controller';
import { TaxonomyScorecardService } from './taxonomy-scorecard.service';
import { SharedElasticsearchModule } from 'src/common/providers/elasticsearch.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: TaxonomyScorecard.name,
        schema: TaxonomyScorecardSchema,
      },
    ]),
    SharedElasticsearchModule,
  ],
  controllers: [TaxonomyScorecardController],
  providers: [TaxonomyScorecardService],
  exports: [TaxonomyScorecardService],
})
export class TaxonomyScorecardModule {}
