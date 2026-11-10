import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';

export const CACHE_TTL_KEY = 'cache_ttl';

/**
 * Sets `Cache-Control` on successful responses of routes marked with
 * `@SetCacheTTL(seconds)`. The header is `private`: there is no shared
 * (CDN) cache in front of the API, and responses depend on the
 * `x-tenant-id`, `accept-language` and `x-api-key` headers, so only the
 * calling browser (e.g. the search widget) may keep a copy.
 */
@Injectable()
export class CacheControlInterceptor implements NestInterceptor {
  constructor(private reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ttl = this.reflector.get<number>(CACHE_TTL_KEY, context.getHandler());

    return next.handle().pipe(
      tap(() => {
        if (ttl !== undefined) {
          const response = context.switchToHttp().getResponse();

          if (response.statusCode === 200) {
            if (ttl === 0) {
              response.setHeader(
                'Cache-Control',
                'no-store, no-cache, must-revalidate, private',
              );
            } else {
              response.setHeader('Cache-Control', `private, max-age=${ttl}`);
            }
          }
        }
      }),
    );
  }
}
