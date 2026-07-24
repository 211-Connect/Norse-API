import {
  Injectable,
  NestMiddleware,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { acceptLanguageSchema } from '../dto/headers.dto';

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

    // Some CDN edges (e.g. DigitalOcean) cache responses by URL only and do
    // not honor `Vary` headers, so `Vary: accept-language` alone does not
    // partition the CDN cache per locale. As a workaround, clients may mirror
    // the resolved locale in a `locale` query param so it becomes part of the
    // cache key. When present, it must match the value resolved from the
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
          `Mismatched locale query param on ${req.originalUrl}: locale=${JSON.stringify(rawLocale)} accept-language=${JSON.stringify(req.headers['accept-language'])}`,
        );
        throw new BadRequestException(
          'locale query parameter does not match accept-language header.',
        );
      }
    }

    next();
  }
}
