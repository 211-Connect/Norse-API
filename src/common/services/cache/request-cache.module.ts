import { Module } from '@nestjs/common';
import { RequestCacheService } from './request-cache.service';

@Module({
  providers: [RequestCacheService],
  exports: [RequestCacheService],
})
export class RequestCacheModule {}
