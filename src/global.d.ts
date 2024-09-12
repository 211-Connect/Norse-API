import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';

declare global {
  namespace Express {
    interface Request {
      cacheService: Cache;
      configService: ConfigService;
      user: User;
      tenant: {
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
      };
    }
  }

  type User = {
    id: string;
  };
}
