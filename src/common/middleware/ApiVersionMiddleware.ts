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
  SUPPORTED_API_VERSIONS,
  requestedApiVersion,
} from '../versioning/api-version';

/** Every route, matched or not, so a 404 carries the release header too. */
export const API_VERSION_MIDDLEWARE_ROUTES: RouteInfo = {
  path: '*',
  method: RequestMethod.ALL,
};

/**
 * Stamps the release on every response (ISS-2482), then refuses an
 * `x-api-version` no route is declared under (ISS-2481). Without this an
 * unknown version fell through to `404 Cannot GET /search`, which reads as
 * "the endpoint does not exist".
 */
@Injectable()
export class ApiVersionMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    res.setHeader(RELEASE_HEADER, releaseInfo().release);

    const requested = requestedApiVersion(req);
    if (
      requested !== undefined &&
      !SUPPORTED_API_VERSIONS.includes(requested)
    ) {
      throw new BadRequestException(
        `${API_VERSION_HEADER} must be one of: ${SUPPORTED_API_VERSIONS.join(', ')} ` +
          `(received "${requested}"). Omit it to use version ${DEFAULT_API_VERSION}.`,
      );
    }
    next();
  }
}
