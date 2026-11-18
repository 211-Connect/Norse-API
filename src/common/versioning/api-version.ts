import { VersioningOptions, VersioningType } from '@nestjs/common';
import type { Request } from 'express';

export const API_VERSION_HEADER = 'x-api-version';

/** What a request without `x-api-version` gets. */
export const DEFAULT_API_VERSION = '1';

/**
 * Every version some route is declared under. A route added under a version
 * missing here answers 400 to its own requests, so the omission is loud.
 */
export const SUPPORTED_API_VERSIONS: readonly string[] = ['1', '2'];

/**
 * The header's value, or `undefined` when it was not sent. An empty header
 * counts as sent: it is a value the caller chose, and it is not a version.
 */
export function requestedApiVersion(req: Request): string | undefined {
  const raw = req.headers[API_VERSION_HEADER];
  if (raw === undefined) return undefined;
  return (Array.isArray(raw) ? raw.join(',') : raw).trim();
}

/** `/v<digits>` at the start of the path, then `/`, `?` or the end. */
const PATH_VERSION = /^\/v(\d+)(?=\/|\?|$)/;

/**
 * The version in the path (`/v2/search` -> `'2'`), or `undefined` when the
 * path has none. The one place that reads a version from a path: the version
 * extractor and the cache interceptor both use it. It only parses; whether a
 * route exists under that version is the router's answer (no route, 404). The
 * app sets no global prefix (main.ts), so the request path starts at `/v<N>`.
 */
export function pathVersionOf(url: string): string | undefined {
  return PATH_VERSION.exec(url)?.[1];
}

/**
 * ISS-2481. `VersioningType.HEADER` with `defaultVersion: '1'` does not do
 * what it reads as: `defaultVersion` sets the version a route is declared
 * under, and a request without the header matches only VERSION_NEUTRAL
 * routes (@nestjs/platform-express `applyVersionFilter`). Every
 * `@Version('1')` route 404'd without the header. A custom extractor applies
 * the default to the request instead.
 *
 * A version in the path (`/v2/...`) wins over the header, so `GET
 * /v2/search` needs no header. Every other request keeps the header, else the
 * default.
 */
export const apiVersioningOptions: VersioningOptions = {
  type: VersioningType.CUSTOM,
  extractor: (req: unknown) => {
    const request = req as Request;
    return (
      pathVersionOf(request.originalUrl ?? request.url ?? '') ??
      requestedApiVersion(request) ??
      DEFAULT_API_VERSION
    );
  },
  defaultVersion: DEFAULT_API_VERSION,
};

/**
 * The version a request is routed to: the path version, else the header, else
 * the default. The same rule as `apiVersioningOptions`, for middleware that
 * runs before routing.
 */
export function effectiveApiVersion(req: Request): string {
  return (
    pathVersionOf(req.originalUrl ?? req.url ?? '') ??
    requestedApiVersion(req) ??
    DEFAULT_API_VERSION
  );
}

/**
 * ADR 0039 Decision 34 (Lucas, 2026-11-18): on v2 the tenant and the language
 * travel in the URL only (`tenant_id`, `locale`), so a copied URL reproduces
 * the exact search and a URL-keyed CDN key holds both.
 */
export function readsTenantFromUrlOnly(req: Request): boolean {
  return effectiveApiVersion(req) === '2';
}
