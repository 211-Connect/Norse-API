import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';

declare global {
  namespace Express {
    interface Request {
      cacheService: Cache;
      configService: ConfigService;
      user: User;
      tenantId: string;
    }
  }

  type User = {
    id: string;
  };
}
