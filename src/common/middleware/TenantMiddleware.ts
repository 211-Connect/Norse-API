import {
  Injectable,
  NestMiddleware,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { xTenantIdSchema } from '../dto/headers.dto';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly logger: Logger;

  constructor() {
    this.logger = new Logger(TenantMiddleware.name);
  }

  async use(req: Request, res: Response, next: NextFunction) {
    const rawHeader = req.headers['x-tenant-id'];

    const validation = xTenantIdSchema.safeParse(rawHeader);
    if (!validation.success) {
      const flattened = validation.error.flatten();
      this.logger.warn(
        `Invalid Tenant Header on ${req.originalUrl}: ${JSON.stringify(flattened)}`,
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
          `Mismatched tenant_id query param on ${req.originalUrl}: tenant_id=${JSON.stringify(rawTenantId)} x-tenant-id=${validation.data}`,
        );
        throw new BadRequestException(
          'tenant_id query parameter does not match x-tenant-id header.',
        );
      }
    }

    next();
  }
}
