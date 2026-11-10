import {
  Injectable,
  NestMiddleware,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { acceptLanguageSchema } from '../dto/headers.dto';
import { requestPathForLog } from '../lib/request-path';

@Injectable()
export class LocaleMiddleware implements NestMiddleware {
  private readonly logger: Logger;

  constructor() {
    this.logger = new Logger(LocaleMiddleware.name);
  }

  async use(req: Request, res: Response, next: NextFunction) {
    const validation = acceptLanguageSchema.safeParse(
      req.headers['accept-language'],
    );

    if (validation.success) {
      req.locale = validation.data;
    }

    // Clients may mirror the resolved locale in a `locale` query param (added
    // for a URL-keyed CDN, no longer in use; the param stays for
    // compatibility). When present, it must match the value resolved from the
    // `accept-language` header exactly.
    const rawLocale = req.query.locale;
    if (rawLocale !== undefined) {
      if (validation.data === '*') {
        this.logger.debug(
          "LocaleMiddleware: accept-language header is '*', skipping locale query param validation.",
        );
        return next();
      }

      if (
        !validation.success ||
        typeof rawLocale !== 'string' ||
        rawLocale !== validation.data
      ) {
        this.logger.warn(
          `Mismatched locale query param on ${requestPathForLog(req)}: accept-language=${JSON.stringify(req.headers['accept-language'])}`,
        );
        throw new BadRequestException(
          'locale query parameter does not match accept-language header.',
        );
      }
    }

    next();
  }
}
