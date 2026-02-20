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

    next();
  }
}
