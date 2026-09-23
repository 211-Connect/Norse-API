import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ArcjetModule, cloudflare } from '@arcjet/nest';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TaxonomyModule } from './taxonomy/taxonomy.module';
import { HealthModule } from 'src/health/health.module';
import { FavoriteModule } from 'src/favorite/favorite.module';
import { FavoriteListModule } from 'src/favorite-list/favorite-list.module';
import { SearchModule } from './search/search.module';
import { ShortUrlModule } from './short-url/short-url.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import configuration from './common/config/configuration';
import { createKeyv } from '@keyv/redis';
import { CacheModule } from '@nestjs/cache-manager';
import { ServiceProviderMiddleware } from './common/middleware/ServiceProviderMiddleware';
import { ResourceModule } from './resource/resource.module';
import { MongooseModule } from '@nestjs/mongoose';
import { TenantMiddleware } from './common/middleware/TenantMiddleware';
import { LocaleMiddleware } from './common/middleware/LocaleMiddleware';
import { TaxonomyController } from './taxonomy/taxonomy.controller';
import { SearchController } from './search/search.controller';
import { ResourceController } from './resource/resource.controller';
import { FavoriteController } from './favorite/favorite.controller';
import { FavoriteListController } from './favorite-list/favorite-list.controller';
import { SuggestionModule } from './suggestion/suggestion.module';
import { SuggestionController } from './suggestion/suggestion.controller';
import { GeocodingModule } from './geocoding/geocoding.module';
import { CmsConfigModule } from './cms-config/cms-config.module';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { GatewayIdentityGuard } from './auth/gateway/gateway-identity.guard';
import { GatewayPermissionsGuard } from './auth/gateway/gateway-permissions.guard';
import { PermissionsSideChannelService } from './auth/gateway/permissions-side-channel.service';
import { TenantScopeGuard } from './auth/gateway/tenant-scope.guard';
import { CdnCacheControlInterceptor } from './common/interceptors/cdn-cache-control.interceptor';
import { MetricsModule } from './metrics/metrics.module';
import { MetricsInterceptor } from './metrics/metrics.interceptor';
import { AnalyticsModule } from './analytics/analytics.module';
import { TaxonomyScorecardModule } from './taxonomy-scorecard/taxonomy-scorecard.module';
import { PrintableDirectoryController } from './printable-directory/printable-directory.controller';
import { PrintableDirectoryPublicController } from './printable-directory/printable-directory-public.controller';
import { PrintableDirectoryModule } from './printable-directory/printable-directory.module';
import { OrganizationModule } from './organization/organization.module';
import { ServiceModule } from './service/service.module';
import { ServiceController } from './service/service.controller';
import { OrganizationController } from './organization/organization.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ load: [configuration], isGlobal: true }),
    ArcjetModule.forRoot({
      isGlobal: true,
      key: process.env.ARCJET_KEY!,
      rules: [],
      proxies: [cloudflare()],
    }),
    CmsConfigModule,
    MetricsModule,
    CacheModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        stores: [createKeyv(configService.get('REDIS_URL'))],
      }),
      inject: [ConfigService],
      isGlobal: true,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get('MONGODB_URI'),
      }),
      inject: [ConfigService],
    }),
    TaxonomyModule,
    SearchModule,
    ShortUrlModule,
    HealthModule,
    FavoriteModule,
    FavoriteListModule,
    ResourceModule,
    SuggestionModule,
    GeocodingModule,
    AnalyticsModule,
    TaxonomyScorecardModule,
    PrintableDirectoryModule,
    OrganizationModule,
    ServiceModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_INTERCEPTOR, useClass: CdnCacheControlInterceptor },
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
    // Gateway guard registration order matters (Nest runs global guards in registration order):
    // GatewayIdentityGuard resolves req.authMode first, so GatewayPermissionsGuard and TenantScopeGuard
    // (registered after it) can rely on it having already run.
    { provide: APP_GUARD, useClass: GatewayIdentityGuard },
    PermissionsSideChannelService,
    { provide: APP_GUARD, useClass: GatewayPermissionsGuard },
    { provide: APP_GUARD, useClass: TenantScopeGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ServiceProviderMiddleware).forRoutes({
      path: '*',
      method: RequestMethod.ALL,
    });

    consumer.apply(TenantMiddleware).forRoutes(
      TaxonomyController,
      SearchController,
      ResourceController,
      FavoriteController,
      FavoriteListController,
      SuggestionController,
      PrintableDirectoryController,
      PrintableDirectoryPublicController,
      OrganizationController,
      // Also enforces ?tenant_id= vs x-tenant-id consistency on a
      // CDN-cached route (cache keys on URL, ignoring Vary).
      ServiceController,
    );

    consumer
      .apply(LocaleMiddleware)
      .forRoutes(
        TaxonomyController,
        SearchController,
        ResourceController,
        FavoriteListController,
        SuggestionController,
        PrintableDirectoryController,
        PrintableDirectoryPublicController,
        OrganizationController,
      );
  }
}
