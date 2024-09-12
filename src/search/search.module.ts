import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { ElasticsearchModule } from '@nestjs/elasticsearch';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TenantMiddleware } from 'src/common/middleware/TenantMiddleware';

@Module({
  controllers: [SearchController],
  providers: [SearchService],
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
export class SearchModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes({
      path: '*',
      method: RequestMethod.ALL,
    });
  }
}
