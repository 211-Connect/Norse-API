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
        this.logger.error('Zod validation error:', error.errors);
        // Throw a BadRequestException with a user-friendly message
        throw new BadRequestException('Invalid or missing x-tenant-id header');
      }

      //If not a Zod Error, rethrow original error
      throw error;
    }
  }
}
