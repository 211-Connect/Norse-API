import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { xTenantIdSchema } from '../../common/dto/headers.dto';

/**
 * ADR 0039 Decision 34 (Lucas, 2026-11-18): v2 reads the tenant and the
 * language from the URL only (`tenant_id`, `locale`); the `x-tenant-id` and
 * `accept-language` headers are not read. A copied URL then reproduces the
 * exact search, and the CDN (keys by URL, ignores `Vary`) keys on both.
 * A missing, empty or invalid value is a 400 that names it.
 *
 * `TenantMiddleware` and `LocaleMiddleware` run first and copy the URL values
 * over the headers; the v2 header pipe checks the exact language code.
 * This guard runs after `V2SearchEnabledGuard`, so a disabled route stays a 404.
 * v1 routes do not use it.
 */
@Injectable()
export class V2UrlMirrorsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { query } = context.switchToHttp().getRequest<Request>();
    for (const param of ['tenant_id', 'locale'] as const) {
      const value = query?.[param];
      if (typeof value !== 'string' || value.trim() === '') {
        throw new BadRequestException(
          `Missing ${param} query parameter. v2 search reads tenant_id and locale from the URL only; the x-tenant-id and accept-language headers are not read.`,
        );
      }
    }
    if (!xTenantIdSchema.safeParse(query.tenant_id).success) {
      throw new BadRequestException(
        'tenant_id query parameter must be a UUID.',
      );
    }
    return true;
  }
}
