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
export const CDN_CACHE_TTL_KEY = 'cdn_cache_ttl';
export const CDN_REQUIRES_URL_MIRRORS_KEY = 'cdn_requires_url_mirrors';

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

function hasUrlMirrors(request: Request): boolean {
  const { tenant_id: tenantId, locale } = request.query ?? {};
  return (
    typeof tenantId === 'string' &&
    tenantId !== '' &&
    typeof locale === 'string' &&
    locale !== ''
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
 *
 * Every stored response also varies on `x-tenant-id` and `accept-language`.
 * Some edges ignore `Vary`, so a route marked `@RequireCdnUrlMirrors()` is
 * stored only when the URL carries both `tenant_id` and `locale` (on v2 the
 * tenant and locale middleware copy these URL values over the headers, ADR
 * 0039 Decision 34); without them the answer is `no-store`, never an error.
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
      tap((body) => {
        if (ttl === undefined) return;
        const http = context.switchToHttp();
        const response = http.getResponse<Response>();
        if (response.statusCode !== 200) return;

        const request = http.getRequest<Request>();
        if (
          ttl === 0 ||
          isMarkedNotStorable(body) ||
          (requiresMirrors && !hasUrlMirrors(request))
        ) {
          response.setHeader('Cache-Control', NO_STORE);
          return;
        }
        response.setHeader(
          'Cache-Control',
          `public, max-age=${ttl}, s-maxage=${ttl}`,
        );
        // The body depends on these two headers. A cache that honors Vary
        // splits on them; one that ignores it (DigitalOcean App Platform's
        // Cloudflare, verified 2026-11-17) relies on the URL mirrors instead.
        appendVary(response, 'x-tenant-id');
        appendVary(response, 'accept-language');
      }),
    );
  }
}
