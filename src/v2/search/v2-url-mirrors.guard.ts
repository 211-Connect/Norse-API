import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';

/**
 * Lucas 2026-11-18: every v2 search request carries `tenant_id` and `locale`
 * in the URL, as copies of the `x-tenant-id` and `accept-language` headers.
 * The CDN keys by URL and ignores `Vary` (a second tenant got another tenant's
 * cached body on 2026-11-17), so with both copies in the URL the key is always
 * safe. A missing or empty copy is a 400 that names it.
 *
 * `TenantMiddleware` and `LocaleMiddleware` run first. They check that each
 * copy matches its header, so this guard only checks that each copy exists.
 * It runs after `V2SearchEnabledGuard`, so a disabled route stays a 404.
 * v1 routes do not use it.
 */
@Injectable()
export class V2UrlMirrorsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { query } = context.switchToHttp().getRequest<Request>();
    for (const param of ['tenant_id', 'locale'] as const) {
      const value = query?.[param];
      if (typeof value !== 'string' || value === '') {
        throw new BadRequestException(
          `Missing ${param} query parameter. v2 search needs tenant_id and locale in the URL, copies of the x-tenant-id and accept-language headers.`,
        );
      }
    }
    return true;
  }
}
