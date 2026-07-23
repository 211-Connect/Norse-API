import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ElasticsearchModule } from '@nestjs/elasticsearch';
import { MetricsModule } from 'src/metrics/metrics.module';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';

@Module({
  controllers: [OrganizationController],
  providers: [OrganizationService],
  imports: [
    MetricsModule,
    ElasticsearchModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (config: ConfigService) => ({
        node: config.get('ELASTIC_NODE'),
        auth: { apiKey: config.get('ELASTIC_API_KEY') },
      }),
      inject: [ConfigService],
    }),
  ],
})
export class OrganizationModule {}
