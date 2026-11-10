import { SetMetadata } from '@nestjs/common';
import { CACHE_TTL_KEY } from '../interceptors/cache-control.interceptor';
import { Seconds } from '../types';

/** Browser cache lifetime for a route; see CacheControlInterceptor. */
export const SetCacheTTL = (ttl: Seconds) => SetMetadata(CACHE_TTL_KEY, ttl);
