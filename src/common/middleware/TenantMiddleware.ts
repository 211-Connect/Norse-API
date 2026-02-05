import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  Inject,
  Injectable,
  NestMiddleware,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { Request, Response, NextFunction } from 'express';
import { xTenantIdSchema } from '../dto/headers.dto';
import { fetchTenantById } from '../lib/utils';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly logger: Logger;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly configService: ConfigService,
  ) {
    this.logger = new Logger(TenantMiddleware.name);
  }

  async use(req: Request, res: Response, next: NextFunction) {
    const rawHeader = req.headers['x-tenant-id'];

    const validation = xTenantIdSchema.safeParse(rawHeader);
    if (!validation.success) {
      const flattened = validation.error.flatten();
      this.logger.warn(`Invalid Tenant Header: ${JSON.stringify(flattened)}`);
      throw new BadRequestException('Missing or invalid x-tenant-id header.');
    }

    try {
      const tenantData = await fetchTenantById(validation.data, { req });
      req.tenant = tenantData;

      next();
    } catch (error) {
      this.logger.error(
        `Error loading tenant for ID ${validation.data} on ${req.originalUrl}`,
        error,
      );
      throw error;
    }
  }
}
