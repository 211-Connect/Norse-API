import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';

export const CDN_CACHE_TTL_KEY = 'cdn_cache_ttl';
export const CDN_REQUIRES_URL_MIRRORS_KEY = 'cdn_requires_url_mirrors';

function hasUrlMirrors(request: { query?: Record<string, unknown> }): boolean {
  const query = request?.query ?? {};
  const isFilled = (value: unknown) =>
    typeof value === 'string' && value.length > 0;
  return isFilled(query.tenant_id) && isFilled(query.locale);
}

const NO_STORE = 'no-store, no-cache, must-revalidate, private';
const VARY_VALUES = ['x-tenant-id', 'accept-language'];

/**
 * Interceptor to set Cache-Control headers for CDN caching
 * Use @SetCdnCacheTTL(seconds) decorator to configure per-route
 *
 * The tenant comes in the x-tenant-id header and the locale in accept-language,
 * but the production CDN caches by URL only and ignores Vary. The tenant_id and
 * locale query params (mirrors of the headers) are therefore the cache key.
 * On routes marked with @RequireCdnUrlMirrors(), a request without both mirrors
 * gets no-store (never an error), so one tenant's answer cannot reach another.
 * Cacheable answers also send Vary for clients that honor it.
 */
@Injectable()
export class CdnCacheControlInterceptor implements NestInterceptor {
  constructor(private reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ttl = this.reflector.get<number>(
      CDN_CACHE_TTL_KEY,
      context.getHandler(),
    );

    const requiresMirrors =
      this.reflector.get<boolean>(
        CDN_REQUIRES_URL_MIRRORS_KEY,
        context.getHandler(),
      ) === true;

    return next.handle().pipe(
      tap(() => {
        if (ttl !== undefined) {
          const response = context.switchToHttp().getResponse();

          if (response.statusCode === 200) {
            const request = context.switchToHttp().getRequest();
            if (ttl === 0 || (requiresMirrors && !hasUrlMirrors(request))) {
              response.setHeader('Cache-Control', NO_STORE);
            } else {
              response.setHeader(
                'Cache-Control',
                `public, max-age=${ttl}, s-maxage=${ttl}`,
              );
              if (requiresMirrors) {
                const existing = String(response.getHeader('Vary') ?? '')
                  .split(',')
                  .map((value) => value.trim())
                  .filter(Boolean);
                const seen = new Set(existing.map((v) => v.toLowerCase()));
                const merged = [
                  ...existing,
                  ...VARY_VALUES.filter((v) => !seen.has(v)),
                ];
                response.setHeader('Vary', merged.join(', '));
              }
            }
          }
        }
      }),
    );
  }
}
