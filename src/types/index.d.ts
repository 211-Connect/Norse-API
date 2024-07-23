type Facets = {
  id: number;
  facet: string;
  name: string;
};

export declare global {
  namespace NodeJS {
    interface ProcessEnv {
      PORT?: string;
      KEYCLOAK_URL?: string;
      MULTI_TENANT?: string;
      STRAPI_URL?: string;
      STRAPI_TOKEN?: string;
      ELASTIC_NODE?: string;
      ELASTIC_API_KEY?: string;
      MONGODB_URI?: string;
      REDIS_URL?: string;
    }
  }

  namespace Express {
    export interface Request {
      tenant: {
        name: string;
        tenantId: string;
        facets: Facets[];
        keycloakRealmId: string;
        appConfig: {
          brandName: string;
          keycloakConfig: {
            id: number;
            clientSecret: string;
            realm: string;
            clientId: string;
          };
        };
      };
      user: {
        id: string;
      };
      origin: string;
    }
  }
}
