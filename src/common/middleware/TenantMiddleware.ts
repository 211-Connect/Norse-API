import {
  Injectable,
  NestMiddleware,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { xTenantIdSchema } from '../dto/headers.dto';
import { requestPathForLog } from '../lib/request-path';
import { readsTenantFromUrlOnly } from '../versioning/api-version';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly logger: Logger;

  constructor() {
    this.logger = new Logger(TenantMiddleware.name);
  }

  async use(req: Request, res: Response, next: NextFunction) {
    if (readsTenantFromUrlOnly(req)) return this.useUrlOnly(req, next);

    const rawHeader = req.headers['x-tenant-id'];

    const validation = xTenantIdSchema.safeParse(rawHeader);
    if (!validation.success) {
      const flattened = validation.error.flatten();
      this.logger.warn(
        `Invalid Tenant Header on ${requestPathForLog(req)}: ${JSON.stringify(flattened)}`,
      );
      throw new BadRequestException('Missing or invalid x-tenant-id header.');
    }

    req.tenantId = validation.data;

    // Some CDN edges (e.g. DigitalOcean) cache responses by URL only and do
    // not honor `Vary` headers, so `Vary: x-tenant-id` alone does not
    // partition the CDN cache per tenant. As a workaround, clients may mirror
    // the tenant in a `tenant_id` query param so it becomes part of the cache key.
    // When present, it must match the `x-tenant-id` header exactly.
    const rawTenantId = req.query.tenant_id;
    if (rawTenantId !== undefined) {
      if (typeof rawTenantId !== 'string' || rawTenantId !== validation.data) {
        this.logger.warn(
          `Mismatched tenant_id query param on ${requestPathForLog(req)}: x-tenant-id=${validation.data}`,
        );
        throw new BadRequestException(
          'tenant_id query parameter does not match x-tenant-id header.',
        );
      }
    }

    next();
  }

  /**
   * v2 (ADR 0039 Decision 34): the tenant comes from `tenant_id` in the URL.
   * The `x-tenant-id` header is not read; it is replaced by the URL value (or
   * removed), so every later reader of the header sees the URL tenant.
   * `V2UrlMirrorsGuard` answers the 400 for a missing or invalid value, after
   * the feature-flag guard, so a disabled route stays a 404.
   */
  private useUrlOnly(req: Request, next: NextFunction) {
    const raw = req.query.tenant_id;
    const parsed = xTenantIdSchema.safeParse(raw);
    if (parsed.success) {
      req.tenantId = parsed.data;
      req.headers['x-tenant-id'] = parsed.data;
    } else {
      delete req.headers['x-tenant-id'];
    }
    next();
  }
}
