import { Module } from '@nestjs/common';
import { TaxonomyService } from './taxonomy.service';
import { TaxonomyController } from './taxonomy.controller';
import { ElasticsearchModule } from '@nestjs/elasticsearch';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  controllers: [TaxonomyController],
  providers: [TaxonomyService],
  imports: [
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
})
export class TaxonomyModule {}
