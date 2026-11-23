import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  TaxonomyScorecard,
  TaxonomyScorecardSchema,
} from 'src/common/schemas/taxonomy-scorecard.schema';
import { TaxonomyScorecardController } from './taxonomy-scorecard.controller';
import { TaxonomyScorecardService } from './taxonomy-scorecard.service';
import { SUNE_SCORECARD_MODEL } from './taxonomy-scorecard.utils';
import { CmsConfigModule } from 'src/cms-config/cms-config.module';
import { SharedElasticsearchModule } from 'src/common/providers/elasticsearch.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: TaxonomyScorecard.name,
        schema: TaxonomyScorecardSchema,
      },
      {
        name: SUNE_SCORECARD_MODEL,
        schema: TaxonomyScorecardSchema,
        collection: 'sune_scorecard',
      },
    ]),
    SharedElasticsearchModule,
    CmsConfigModule,
  ],
  controllers: [TaxonomyScorecardController],
  providers: [TaxonomyScorecardService],
  exports: [TaxonomyScorecardService],
})
export class TaxonomyScorecardModule {}
