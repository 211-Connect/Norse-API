import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ElasticsearchModule } from '@nestjs/elasticsearch';
import { elasticsearchOptions } from '../elasticsearch/v2-isolation';

@Module({
  imports: [
    ElasticsearchModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) =>
        elasticsearchOptions(configService),
      inject: [ConfigService],
    }),
  ],
  exports: [ElasticsearchModule],
})
export class SharedElasticsearchModule {}
