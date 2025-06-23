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
import { ZodError } from 'zod';

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
    try {
      const tenantHeader = await xTenantIdSchema.parseAsync(
        req.headers['x-tenant-id'],
      );

      const tenantData = await fetchTenantById(tenantHeader, { req });
      req.tenant = tenantData;

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        this.logger.error(
          `Zod validation error for tenant on path: ${req.originalUrl}`,
        );
        this.logger.error(JSON.stringify(error.errors, null, 2));

        // Throw a BadRequestException with a user-friendly message
        throw new BadRequestException('Missing or invalid x-tenant-id header.');
      }

      // Re-throw other unexpected errors
      this.logger.error(
        `Unexpected error in TenantMiddleware on path: ${req.originalUrl}`,
        error,
      );
      throw error;
    }
  }
}
