import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request } from 'express';

import { resolveCdnTtl } from '../internal/analytics-cache-ttl';
import { CommonAnalyticsQuery, TimezoneAnalyticsQueryDto } from '../dto';

/**
 * Sets a dynamic CDN Cache-Control header for analytics endpoints.
 *
 * The TTL depends on whether the requested date range is fully in the past
 * (closed range → long TTL) or includes today (open range → short TTL).
 */
@Injectable()
export class AnalyticsCdnCacheInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const query = request.query as unknown as
      | CommonAnalyticsQuery
      | TimezoneAnalyticsQueryDto;

    const startMs = Date.parse(query.start ?? '');
    const endMs = Date.parse(query.end ?? '');

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse();
        if (response.statusCode !== 200) return;
        if (Number.isNaN(startMs) || Number.isNaN(endMs)) return;

        const timezone =
          'timezone' in query && query.timezone ? query.timezone : undefined;
        const route = request.route?.path ?? request.path ?? '';
        const endpoint = route.split('/').pop() || 'unknown';

        const ttl = resolveCdnTtl(endpoint, endMs, timezone);

        response.setHeader('Vary', 'x-tenant-id, accept-language');
        response.setHeader(
          'Cache-Control',
          `public, max-age=${ttl}, s-maxage=${ttl}`,
        );
      }),
    );
  }
}
