import {
  Injectable,
  NestMiddleware,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { xTenantIdSchema } from '../dto/headers.dto';
import { requestPathForLog } from '../lib/request-path';

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
        `Invalid Tenant Header on ${requestPathForLog(req)}: ${JSON.stringify(flattened)}`,
      );
      throw new BadRequestException('Missing or invalid x-tenant-id header.');
    }

    req.tenantId = validation.data;

    // Clients may mirror the tenant in a `tenant_id` query param (added for a
    // URL-keyed CDN, no longer in use; the param stays for compatibility).
    // When present, it must match the `x-tenant-id` header exactly, so a URL
    // never names one tenant while the header names another.
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
}
