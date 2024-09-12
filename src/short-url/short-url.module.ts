import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { ShortUrlService } from './short-url.service';
import { ShortUrlController } from './short-url.controller';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ShortenedUrl,
  ShortenedUrlSchema,
} from 'src/common/schemas/shortened-url.schema';
import { TenantMiddleware } from 'src/common/middleware/TenantMiddleware';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ShortenedUrl.name, schema: ShortenedUrlSchema },
    ]),
  ],
  controllers: [ShortUrlController],
  providers: [ShortUrlService],
})
export class ShortUrlModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes({
      path: '*',
      method: RequestMethod.ALL,
    });
  }
}
