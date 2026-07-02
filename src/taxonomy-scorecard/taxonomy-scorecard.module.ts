import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  TaxonomyScorecard,
  TaxonomyScorecardSchema,
} from 'src/common/schemas/taxonomy-scorecard.schema';
import { TaxonomyScorecardController } from './taxonomy-scorecard.controller';
import { TaxonomyScorecardService } from './taxonomy-scorecard.service';
import { ElasticsearchModule } from '@nestjs/elasticsearch';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: TaxonomyScorecard.name,
        schema: TaxonomyScorecardSchema,
      },
    ]),
    ElasticsearchModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        node: configService.get('ELASTIC_NODE'),
        auth: {
          apiKey: configService.get('ELASTIC_API_KEY'),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [TaxonomyScorecardController],
  providers: [TaxonomyScorecardService],
  exports: [TaxonomyScorecardService],
})
export class TaxonomyScorecardModule {}
