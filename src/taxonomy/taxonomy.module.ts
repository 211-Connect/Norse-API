import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { TaxonomyService } from './taxonomy.service';
import { TaxonomyController } from './taxonomy.controller';
import { ElasticsearchModule } from '@nestjs/elasticsearch';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TenantMiddleware } from 'src/common/middleware/TenantMiddleware';

@Module({
  controllers: [TaxonomyController],
  providers: [TaxonomyService],
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
export class TaxonomyModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes({
      path: '*',
      method: RequestMethod.ALL,
    });
  }
}
