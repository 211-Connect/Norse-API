import {
  Injectable,
  NestMiddleware,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { acceptLanguageSchema } from '../dto/headers.dto';
import { requestPathForLog } from '../lib/request-path';
import { readsTenantFromUrlOnly } from '../versioning/api-version';

@Injectable()
export class LocaleMiddleware implements NestMiddleware {
  private readonly logger: Logger;

  constructor() {
    this.logger = new Logger(LocaleMiddleware.name);
  }

  async use(req: Request, res: Response, next: NextFunction) {
    if (readsTenantFromUrlOnly(req)) return this.useUrlOnly(req, next);

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
          `Mismatched locale query param on ${requestPathForLog(req)}: accept-language=${JSON.stringify(req.headers['accept-language'])}`,
        );
        throw new BadRequestException(
          'locale query parameter does not match accept-language header.',
        );
      }
    }

    next();
  }

  /**
   * v2 (ADR 0039 Decision 34): the language comes from `locale` in the URL.
   * The `accept-language` header is not read; it is replaced by the URL value
   * (or removed). The exact-code check (Decision 72) stays in the v2 header
   * pipe, which now reads the URL value.
   */
  private useUrlOnly(req: Request, next: NextFunction) {
    const raw = req.query.locale;
    if (typeof raw === 'string' && raw.trim() !== '') {
      req.headers['accept-language'] = raw;
      req.locale = raw.trim().toLowerCase();
    } else {
      delete req.headers['accept-language'];
    }
    next();
  }
}
