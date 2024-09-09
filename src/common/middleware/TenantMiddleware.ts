import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { Request, Response, NextFunction } from 'express';
import { xTenantIdSchema } from '../dto/headers.dto';
import { fetchTenantById } from '../lib/utils';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly configService: ConfigService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const tenantHeader = await xTenantIdSchema.parseAsync(
      req.headers['x-tenant-id'],
    );

    const tenantData = await fetchTenantById(tenantHeader, { req });
    req.tenant = tenantData;

    next();
  }
}
