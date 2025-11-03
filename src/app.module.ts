import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
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
import type { RedisClientOptions } from 'redis';
import { redisStore } from 'cache-manager-redis-store';
import { CacheModule } from '@nestjs/cache-manager';
import { ServiceProviderMiddleware } from './common/middleware/ServiceProviderMiddleware';
import { ResourceModule } from './resource/resource.module';
import { MongooseModule } from '@nestjs/mongoose';
import { TenantMiddleware } from './common/middleware/TenantMiddleware';
import { TaxonomyController } from './taxonomy/taxonomy.controller';
import { ShortUrlController } from './short-url/short-url.controller';
import { SearchController } from './search/search.controller';
import { ResourceController } from './resource/resource.controller';
import { FavoriteController } from './favorite/favorite.controller';
import { FavoriteListController } from './favorite-list/favorite-list.controller';
import { SuggestionModule } from './suggestion/suggestion.module';
import { SuggestionController } from './suggestion/suggestion.controller';
import { HybridSemanticModule } from './hybrid_semantic/hybrid-semantic.module';
import { HybridSemanticController } from './hybrid_semantic/hybrid-semantic.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ load: [configuration], isGlobal: true }),
    CacheModule.registerAsync<RedisClientOptions>({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        store: redisStore,
        url: configService.get('REDIS_URL'),
        pingInterval: 4 * 60 * 1000,
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
    HybridSemanticModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ServiceProviderMiddleware).forRoutes({
      path: '*',
      method: RequestMethod.ALL,
    });

    consumer
      .apply(TenantMiddleware)
      .forRoutes(
        TaxonomyController,
        ShortUrlController,
        SearchController,
        ResourceController,
        FavoriteController,
        FavoriteListController,
        SuggestionController,
        HybridSemanticController,
      );
  }
}
