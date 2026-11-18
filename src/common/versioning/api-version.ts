import {
  VERSION_NEUTRAL,
  VersioningOptions,
  VersioningType,
} from '@nestjs/common';
import type { VersionValue } from '@nestjs/common/interfaces';
import type { Request } from 'express';

/**
 * ISS-2496 (ADR 0039 Decision 10; Lucas, 2026-11-17). The path picks the API
 * version: `/v1/search` is v1, `/v2/search` is v2. Nest serves real versioned
 * routes (`VersioningType.URI`); nothing rewrites the request.
 *
 * Who decides what:
 * - The router owns "is there a route under this version?". A path no route
 *   is declared under (`/v9/search`, `/v1/v1/search`) is a plain 404.
 * - `ApiVersionMiddleware` owns the `x-api-version` header, for every route:
 *   `1` (what current callers and the SDK send) is ignored, any other value
 *   is a 400. The header no longer picks a version.
 * - `pathVersionOf` is the one place that reads a version from a path (the log
 *   line uses it).
 */
export const API_VERSION_HEADER = 'x-api-version';

/** The version of the legacy unversioned path, and the only header value accepted. */
export const DEFAULT_API_VERSION = '1';

/**
 * Transition: a v1 route answers at `/v1/<route>` and at the legacy
 * `/<route>`. The gateway strips `/norse-api/v1` today, so callers reach the
 * legacy path; once the chart sets `versionPrefix: ""` they reach `/v1/...`.
 * Probes and Prometheus keep calling `/health` and `/metrics`. To retire the
 * legacy path, drop `VERSION_NEUTRAL` here.
 */
export const V1_AND_LEGACY: VersionValue = [
  DEFAULT_API_VERSION,
  VERSION_NEUTRAL,
];

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
 * path has none. The one place that reads a version from a path. It only
 * parses; whether a route exists under that version is the router's answer
 * (no route, 404). The app sets no global prefix (main.ts), so the request
 * path starts at `/v<N>`.
 */
export function pathVersionOf(url: string): string | undefined {
  return PATH_VERSION.exec(url)?.[1];
}

/**
 * A controller or handler without its own `@Version` gets `V1_AND_LEGACY`.
 * v2 routes declare `@Version('2')` and live at `/v2/...` only.
 */
export const apiVersioningOptions: VersioningOptions = {
  type: VersioningType.URI,
  defaultVersion: V1_AND_LEGACY,
};

/**
 * The version a request is routed to: the path version, else the default.
 * The header never picks a version (ADR 0039 Decision 9; `1` is ignored and
 * any other value is a 400 in `ApiVersionMiddleware`). The same rule as
 * `apiVersioningOptions`, for middleware that runs before routing.
 */
export function effectiveApiVersion(req: Request): string {
  return pathVersionOf(req.originalUrl ?? req.url ?? '') ?? DEFAULT_API_VERSION;
}

/**
 * ADR 0039 Decision 34 (Lucas, 2026-11-18): on v2 the tenant and the language
 * travel in the URL only (`tenant_id`, `locale`), so a copied URL reproduces
 * the exact search and a URL-keyed CDN key holds both.
 */
export function readsTenantFromUrlOnly(req: Request): boolean {
  return effectiveApiVersion(req) === '2';
}
