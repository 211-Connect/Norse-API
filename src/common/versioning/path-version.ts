import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { API_VERSION_HEADER, SUPPORTED_API_VERSIONS } from './api-version';

/** `/v<digits>` at the start of the path, then `/`, `?` or the end. */
const VERSION_PREFIX = /^\/v(\d+)(?=\/|\?|$)/;

/**
 * ISS-2496, ADR 0039 Decision 10 (option B). The gateway strips only
 * `/norse-api`, so a caller's `/v1/search` or `/v2/search` reaches this
 * service with the version still in the path.
 *
 * Returns the version and the URL without the prefix, or `null` when the URL
 * has no prefix, or a prefix no route is declared under. A `null` leaves the
 * URL as it is, so `/v9/search` is a 404 like any other unknown path.
 */
export function resolvePathVersion(
  url: string,
  supported: readonly string[] = SUPPORTED_API_VERSIONS,
): { version: string; url: string } | null {
  const match = VERSION_PREFIX.exec(url);
  if (!match) return null;
  const version = match[1];
  if (!supported.includes(version)) return null;
  const rest = url.slice(match[0].length);
  return { version, url: rest.startsWith('/') ? rest : `/${rest}` };
}

/**
 * Rewrites `/v<N>/<route>` to `/<route>` and sets the version header to N,
 * so the request is the same as `/<route>` with `x-api-version: N`. The path
 * wins over a header the caller sent. `req.originalUrl` stays as sent, so
 * error bodies and logs show the path the caller used.
 */
export function pathVersionMiddleware(
  supported: readonly string[] = SUPPORTED_API_VERSIONS,
) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const resolved = resolvePathVersion(req.url, supported);
    if (resolved) {
      req.url = resolved.url;
      req.headers[API_VERSION_HEADER] = resolved.version;
    }
    next();
  };
}

/**
 * Must be the first `app.use` in main.ts: every layer after it, such as the
 * `/internal/services` body limit, then sees the path without the prefix.
 */
export function usePathVersion(
  app: INestApplication,
  supported: readonly string[] = SUPPORTED_API_VERSIONS,
): void {
  app.use(pathVersionMiddleware(supported));
}
