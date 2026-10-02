import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';

declare global {
  namespace Express {
    interface Request {
      cacheService: Cache;
      configService: ConfigService;
      user: User;
      tenantId: string;
      locale?: string;
      /**
       * 'gateway' when both X-Connect211-* headers are present and valid
       * (GatewayIdentityGuard); 'legacy' otherwise. Temporary: remove once
       * the NextJS app / client widget fully migrate to the gateway
       */
      authMode?: 'gateway' | 'legacy';
      gatewayPrincipal?: { externalId: string; keyId: string };
      gatewayPermissions?: string[];
      targetTenantId?: string;
    }
  }

  type User = {
    id: string;
  };
}
