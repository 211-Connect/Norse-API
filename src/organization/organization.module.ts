import { Module } from '@nestjs/common';
import { MetricsModule } from 'src/metrics/metrics.module';
import { SharedElasticsearchModule } from 'src/common/providers/elasticsearch.module';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';

@Module({
  controllers: [OrganizationController],
  providers: [OrganizationService],
  imports: [MetricsModule, SharedElasticsearchModule],
})
export class OrganizationModule {}
