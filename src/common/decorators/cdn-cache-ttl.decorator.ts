import { SetMetadata } from '@nestjs/common';
import {
  CDN_CACHE_TTL_KEY,
  CDN_REQUIRES_URL_MIRRORS_KEY,
} from '../interceptors/cdn-cache-control.interceptor';
import { Seconds } from '../types';

export const SetCdnCacheTTL = (ttl: Seconds) =>
  SetMetadata(CDN_CACHE_TTL_KEY, ttl);

/**
 * The route's response is storable by a shared cache only when the URL has the
 * `tenant_id` and `locale` mirrors. Use it where a URL-keyed CDN could
 * otherwise serve one tenant's or language's answer to another.
 */
export const RequireCdnUrlMirrors = () =>
  SetMetadata(CDN_REQUIRES_URL_MIRRORS_KEY, true);
