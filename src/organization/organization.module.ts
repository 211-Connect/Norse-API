import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MetricsModule } from 'src/metrics/metrics.module';
import { SharedElasticsearchModule } from 'src/common/providers/elasticsearch.module';
import {
  Organization,
  OrganizationSchema,
} from 'src/common/schemas/organization.schema';
import { Redirect, RedirectSchema } from 'src/common/schemas/redirect.schema';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';
import { OrganizationDetailService } from './organization-detail.service';

@Module({
  controllers: [OrganizationController],
  providers: [OrganizationService, OrganizationDetailService],
  imports: [
    MetricsModule,
    SharedElasticsearchModule,
    MongooseModule.forFeature([
      { name: Organization.name, schema: OrganizationSchema },
      { name: Redirect.name, schema: RedirectSchema },
    ]),
  ],
})
export class OrganizationModule {}
