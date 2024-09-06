import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';

declare global {
  namespace Express {
    interface Request {
      cacheService: Cache;
      configService: ConfigService;
    }
  }

  interface Tenant {
    name: string;
    tenantId: string;
    createdAt: string;
    updatedAt: string;
    keycloakRealmId: string;
    facets: {
      facet: string;
      name: string;
    }[];
    appConfig: {
      brandName: string;
      feedbackUrl: string;
      email: string;
      phoneNumber: string;
    };
  }
}
