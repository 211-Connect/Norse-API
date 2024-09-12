import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class ServiceProviderMiddleware implements NestMiddleware {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly configService: ConfigService,
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    req.cacheService = this.cacheManager;
    req.configService = this.configService;
    next();
  }
}
