import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
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

/**
 * Sets Cache-Control for CDN and shared caches. Configure per route with
 * `@SetCdnCacheTTL(seconds)`; a handler can still opt one response out with
 * `markNotStorable(body)`.
 *
 *
 * The path alone picks the API version (ISS-2496), so one URL answers one
 * version and nothing needs to vary on `x-api-version`.
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

        if (ttl === 0 || isMarkedNotStorable(body)) {
          response.setHeader('Cache-Control', NO_STORE);
          return;
        }
        response.setHeader(
          'Cache-Control',
          `public, max-age=${ttl}, s-maxage=${ttl}`,
        );
      }),
    );
  }
}
