import { SetMetadata } from '@nestjs/common';
import {
  CDN_CACHE_TTL_KEY,
  CDN_REQUIRES_URL_MIRRORS_KEY,
} from '../interceptors/cdn-cache-control.interceptor';
import { Seconds } from '../types';

export const SetCdnCacheTTL = (ttl: Seconds) =>
  SetMetadata(CDN_CACHE_TTL_KEY, ttl);

/** Marks a cached route as safe for the CDN only when tenant_id and locale are in the URL. */
export const RequireCdnUrlMirrors = () =>
  SetMetadata(CDN_REQUIRES_URL_MIRRORS_KEY, true);
