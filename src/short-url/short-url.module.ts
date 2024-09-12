import { Module } from '@nestjs/common';
import { ShortUrlService } from './short-url.service';
import { ShortUrlController } from './short-url.controller';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ShortenedUrl,
  ShortenedUrlSchema,
} from 'src/common/schemas/shortened-url.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ShortenedUrl.name, schema: ShortenedUrlSchema },
    ]),
  ],
  controllers: [ShortUrlController],
  providers: [ShortUrlService],
})
export class ShortUrlModule {}
