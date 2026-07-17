import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { CmsConfigModule } from '../cms-config/cms-config.module';
import { ResourceModule } from '../resource/resource.module';
import { GeocodingModule } from '../geocoding/geocoding.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsApiKeyGuard } from './guards/analytics-api-key.guard';
import { AnalyticsConfigService } from './services/analytics-config.service';
import { AnalyticsCacheService } from './services/analytics-cache.service';
import { AnalyticsInfoEnricherService } from './services/analytics-info-enricher.service';
import { UmamiAnalyticsService } from './services/umami-analytics.service';
import { UmamiAuthService } from './services/umami-auth.service';
import { UmamiHttpService } from './services/umami-http.service';
import { AnalyticsCdnCacheInterceptor } from './interceptors/analytics-cdn-cache.interceptor';

@Module({
  imports: [ConfigModule, ResourceModule, CmsConfigModule, GeocodingModule],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsApiKeyGuard,
    AnalyticsConfigService,
    AnalyticsCacheService,
    AnalyticsCdnCacheInterceptor,
    AnalyticsInfoEnricherService,
    UmamiAuthService,
    UmamiHttpService,
    UmamiAnalyticsService,
  ],
})
export class AnalyticsModule {}
