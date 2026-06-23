import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { CmsConfigModule } from '../cms-config/cms-config.module';
import { ResourceModule } from '../resource/resource.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsApiKeyGuard } from './guards/analytics-api-key.guard';
import { AnalyticsConfigService } from './services/analytics-config.service';
import { AnalyticsCacheService } from './services/analytics-cache.service';
import { UmamiAnalyticsService } from './services/umami-analytics.service';
import { UmamiAuthService } from './services/umami-auth.service';
import { UmamiHttpService } from './services/umami-http.service';
import { AnalyticsCdnCacheInterceptor } from './interceptors/analytics-cdn-cache.interceptor';

@Module({
  imports: [ConfigModule, ResourceModule, CmsConfigModule],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsApiKeyGuard,
    AnalyticsConfigService,
    AnalyticsCacheService,
    AnalyticsCdnCacheInterceptor,
    UmamiAuthService,
    UmamiHttpService,
    UmamiAnalyticsService,
  ],
})
export class AnalyticsModule {}
