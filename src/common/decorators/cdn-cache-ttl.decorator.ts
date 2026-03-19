import { SetMetadata } from '@nestjs/common';
import { CDN_CACHE_TTL_KEY } from '../interceptors/cdn-cache-control.interceptor';
import { Seconds } from '../types';

export const SetCdnCacheTTL = (ttl: Seconds) =>
  SetMetadata(CDN_CACHE_TTL_KEY, ttl);
