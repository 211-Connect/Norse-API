import {
  BadRequestException,
  Injectable,
  NestMiddleware,
  RequestMethod,
} from '@nestjs/common';
import type { RouteInfo } from '@nestjs/common/interfaces';
import { NextFunction, Request, Response } from 'express';
import { RELEASE_HEADER, releaseInfo } from '../release/release-info';
import {
  API_VERSION_HEADER,
  DEFAULT_API_VERSION,
  requestedApiVersion,
} from '../versioning/api-version';

/** Every route, matched or not, so a 404 carries the release header too. */
export const API_VERSION_MIDDLEWARE_ROUTES: RouteInfo = {
  path: '*',
  method: RequestMethod.ALL,
};

/**
 * Stamps the release on every response (ISS-2482), then checks the
 * `x-api-version` header (ISS-2496). The path picks the version now, so the
 * header may only be `1`, what current callers and the SDK send, and is then
 * ignored. Any other value is a 400 that says to use the path: silently
 * serving v1 to a caller who asked for 2 would hide the mistake.
 */
@Injectable()
export class ApiVersionMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    res.setHeader(RELEASE_HEADER, releaseInfo().release);

    const requested = requestedApiVersion(req);
    if (requested !== undefined && requested !== DEFAULT_API_VERSION) {
      throw new BadRequestException(
        `${API_VERSION_HEADER} no longer picks the API version; the path does ` +
          `(/v1/..., /v2/...). Omit the header or send ${DEFAULT_API_VERSION} ` +
          `(received "${requested}").`,
      );
    }
    next();
  }
}
