import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import {
  API_VERSION_HEADER,
  DEFAULT_API_VERSION,
  isV2Path,
  requestedApiVersion,
} from '../versioning/api-version';

export const CDN_CACHE_TTL_KEY = 'cdn_cache_ttl';

const NO_STORE = 'no-store, no-cache, must-revalidate, private';
const NOT_STORABLE = Symbol('cdnNotStorable');

/**
 * Marks one response body as not storable by a shared cache, whatever the
 * route's `@SetCdnCacheTTL`. For a route whose cacheability depends on the
 * answer (v2 search: an emergency question, ADR 0039 Decision 28). The mark
 * is a non-enumerable symbol: JSON.stringify and equality checks never see
 * it, so the response gains no field (Decision 59).
 */
export function markNotStorable<T extends object>(body: T): T {
  Object.defineProperty(body, NOT_STORABLE, { value: true, enumerable: false });
  return body;
}

export function isMarkedNotStorable(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as Record<symbol, unknown>)[NOT_STORABLE] === true
  );
}

function appendVary(response: Response, field: string): void {
  const current = response.getHeader('Vary');
  const existing = current === undefined ? '' : String(current);
  const fields = existing
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);
  if (fields.some((f) => f.toLowerCase() === field.toLowerCase())) return;
  response.setHeader('Vary', [...fields, field].join(', '));
}

/**
 * Sets Cache-Control for CDN and shared caches. Configure per route with
 * `@SetCdnCacheTTL(seconds)`; a handler can still opt one response out with
 * `markNotStorable(body)`.
 *
 * On a path without a version (`/search`), the `x-api-version` header picks
 * the version (ADR 0039 Decision 9), so one URL can answer two versions. A
 * cache keyed by URL alone would then hand a v1 body to a v2 caller, or the
 * reverse. So on such a path:
 * - a stored response varies on `x-api-version` (dropped in Norse-API PR #201,
 *   ADR 0039 Question 11);
 * - a response whose header picked a version other than the default is never
 *   stored, so it cannot reach a v1 caller of the same URL.
 * A version in the path (`/v2/...`) is part of the URL and needs neither.
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
      tap((body) => {
        if (ttl === undefined) return;
        const http = context.switchToHttp();
        const response = http.getResponse<Response>();
        if (response.statusCode !== 200) return;

        const request = http.getRequest<Request>();
        const versionInPath = isV2Path(
          request.originalUrl ?? request.url ?? '',
        );
        const headerVersion = versionInPath
          ? undefined
          : requestedApiVersion(request);
        const headerPickedOther =
          headerVersion !== undefined && headerVersion !== DEFAULT_API_VERSION;

        if (ttl === 0 || headerPickedOther || isMarkedNotStorable(body)) {
          response.setHeader('Cache-Control', NO_STORE);
          return;
        }
        response.setHeader(
          'Cache-Control',
          `public, max-age=${ttl}, s-maxage=${ttl}`,
        );
        if (!versionInPath) appendVary(response, API_VERSION_HEADER);
      }),
    );
  }
}
