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

/**
 * Interceptor to set Cache-Control headers for CDN caching
 * Use @SetCdnCacheTTL(seconds) decorator to configure per-route
 */
@Injectable()
export class CdnCacheControlInterceptor implements NestInterceptor {
  constructor(private reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ttl = this.reflector.get<number>(
      CDN_CACHE_TTL_KEY,
      context.getHandler(),
    );

    return next.handle().pipe(
      tap(() => {
        if (ttl !== undefined) {
          const response = context.switchToHttp().getResponse();

          if (response.statusCode === 200) {
            response.setHeader('Vary', 'x-tenant-id, accept-language');

            if (ttl === 0) {
              response.setHeader(
                'Cache-Control',
                'no-store, no-cache, must-revalidate, private',
              );
            } else {
              response.setHeader(
                'Cache-Control',
                `public, max-age=${ttl}, s-maxage=${ttl}`,
              );
            }
          }
        }
      }),
    );
  }
}
