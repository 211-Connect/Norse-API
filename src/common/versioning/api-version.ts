import { VersioningOptions, VersioningType } from '@nestjs/common';
import type { Request } from 'express';

export const API_VERSION_HEADER = 'x-api-version';

/** What a request without `x-api-version` gets. */
export const DEFAULT_API_VERSION = '1';

/**
 * Every version some route is declared under. A route added under a version
 * missing here answers 400 to its own requests, so the omission is loud.
 */
export const SUPPORTED_API_VERSIONS: readonly string[] = ['1'];

/**
 * The header's value, or `undefined` when it was not sent. An empty header
 * counts as sent: it is a value the caller chose, and it is not a version.
 */
export function requestedApiVersion(req: Request): string | undefined {
  const raw = req.headers[API_VERSION_HEADER];
  if (raw === undefined) return undefined;
  return (Array.isArray(raw) ? raw.join(',') : raw).trim();
}

/**
 * ISS-2481. `VersioningType.HEADER` with `defaultVersion: '1'` does not do
 * what it reads as: `defaultVersion` sets the version a route is declared
 * under, and a request without the header matches only VERSION_NEUTRAL
 * routes (@nestjs/platform-express `applyVersionFilter`). Every
 * `@Version('1')` route 404'd without the header. A custom extractor applies
 * the default to the request instead.
 */
export const apiVersioningOptions: VersioningOptions = {
  type: VersioningType.CUSTOM,
  extractor: (req: unknown) =>
    requestedApiVersion(req as Request) ?? DEFAULT_API_VERSION,
  defaultVersion: DEFAULT_API_VERSION,
};
