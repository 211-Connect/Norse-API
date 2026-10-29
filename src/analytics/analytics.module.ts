import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { CmsConfigModule } from '../cms-config/cms-config.module';
import { ResourceModule } from '../resource/resource.module';
import { GeocodingModule } from '../geocoding/geocoding.module';
import {
  BlockedTrafficHourly,
  BlockedTrafficHourlySchema,
} from '../common/schemas/blocked-traffic-hourly.schema';
import { AnalyticsController } from './analytics.controller';
import { BlockedTrafficInternalController } from './blocked-traffic-internal.controller';
import { AnalyticsApiKeyGuard } from './guards/analytics-api-key.guard';
import { AnalyticsConfigService } from './services/analytics-config.service';
import { AnalyticsCacheService } from './services/analytics-cache.service';
import { AnalyticsInfoEnricherService } from './services/analytics-info-enricher.service';
import { BlockedTrafficService } from './services/blocked-traffic.service';
import { UmamiAnalyticsService } from './services/umami-analytics.service';
import { UmamiHttpService } from './services/umami-http.service';

@Module({
  imports: [
    ConfigModule,
    ResourceModule,
    CmsConfigModule,
    GeocodingModule,
    MongooseModule.forFeature([
      { name: BlockedTrafficHourly.name, schema: BlockedTrafficHourlySchema },
    ]),
  ],
  controllers: [AnalyticsController, BlockedTrafficInternalController],
  providers: [
    AnalyticsApiKeyGuard,
    AnalyticsConfigService,
    AnalyticsCacheService,
    AnalyticsInfoEnricherService,
    BlockedTrafficService,
    UmamiHttpService,
    UmamiAnalyticsService,
  ],
})
export class AnalyticsModule {}
