import {
  Logger,
  InternalServerErrorException, // For truly unexpected errors
  UnauthorizedException, // For auth-specific failures
  ForbiddenException, // If a user is authenticated but not allowed
  NotFoundException, // If a required resource (like tenant config) is missing
  BadRequestException, // For malformed requests
} from '@nestjs/common';
import { Request } from 'express';
import qs from 'qs';
import * as jwt from 'jsonwebtoken';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { Cache } from 'cache-manager';
import { createPublicKey, JsonWebKey, KeyObject } from 'crypto';

// Define a logger for this utility module
const logger = new Logger('AuthUtils');

// Define a more specific type for Keycloak Certs
interface KeycloakCert {
  kid: string;
  kty: string;
  alg: string;
  use: string;
  n: string;
  e: string;
  x5c: string[];
  x5t: string;
  'x5t#S256': string;
}

interface KeycloakCertsResponse {
  keys: KeycloakCert[];
}

export async function fetchTenantById(
  id: string,
  { req }: { req: Request },
): Promise<Request['tenant']> {
  const cachedData = await req.cacheService.get<Request['tenant']>(
    `tenant:${id}`,
  );

  if (cachedData) return cachedData;

  const strapiPopulateQuery = qs.stringify({
    populate: {
      facets: {
        populate: '*',
      },
      app_config: {
        populate: 'keycloakConfig',
      },
    },
  });

  const url = `${req.configService.get('STRAPI_URL')}/api/tenants?filters[tenantId][$eq]=${id}&${strapiPopulateQuery}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${req.configService.get('STRAPI_TOKEN')}`,
    },
  });

  if (!response.ok) {
    logger.error(
      `Failed to fetch tenant from Strapi. Status: ${response.status}`,
    );

    throw new InternalServerErrorException(
      `Failed to fetch tenant configuration from Strapi (Status: ${response.status}).`,
    );
  }

  const res = await response.json();
  const initialData = res?.data?.[0]?.attributes;
  if (!initialData) {
    throw new BadRequestException('Tenant data not found in CMS (Strapi)');
  }

  const { app_config, ...rest } = initialData;
  const appConfig = app_config?.data?.attributes;
  if (!initialData) {
    throw new BadRequestException('AppConfig data not found in CMS (Strapi)');
  }

  const tenantData = {
    ...rest,
    appConfig,
  };

  await req.cacheService.set(`tenant:${id}`, tenantData, 0);

  return tenantData;
}

async function getKeycloakCerts(
  tenantKeycloakRealmId: string,
  authServerUrl: string,
  cacheService: Cache,
): Promise<KeycloakCertsResponse['keys']> {
  const cacheKey = `keycloak:${tenantKeycloakRealmId}`;
  const cachedCerts =
    await cacheService.get<KeycloakCertsResponse['keys']>(cacheKey);

  if (cachedCerts) {
    logger.debug(
      `Using cached Keycloak certs for realm: ${tenantKeycloakRealmId}`,
    );
    return cachedCerts;
  }

  const certsUrl = `${authServerUrl}/realms/${tenantKeycloakRealmId}/protocol/openid-connect/certs`;
  logger.log(`Fetching Keycloak certs from: ${certsUrl}`);

  try {
    const response = await fetch(certsUrl);
    if (!response.ok) {
      logger.error(
        `Failed to fetch Keycloak certs. Status: ${response.status} ${response.statusText}`,
      );
      throw new InternalServerErrorException(
        `Failed to retrieve Keycloak certificates for realm ${tenantKeycloakRealmId}. Service may be temporarily unavailable (Status: ${response.status}).`,
      );
    }

    const data: KeycloakCertsResponse = await response.json();

    if (!data || !data.keys || data.keys.length === 0) {
      logger.error(
        `No Keycloak certs found at ${certsUrl} for realm ${tenantKeycloakRealmId}`,
      );
      throw new InternalServerErrorException(
        `Keycloak certs configuration error for realm ${tenantKeycloakRealmId}.`,
      );
    }

    // TODO: Cache with TTL 0 (never expire) - consider if this is appropriate or if a shorter TTL is needed
    await cacheService.set(cacheKey, data.keys, 0);
    logger.log(
      `Successfully fetched and cached Keycloak certs for realm: ${tenantKeycloakRealmId}`,
    );
    return data.keys;
  } catch (error) {
    if (error instanceof InternalServerErrorException) {
      throw error;
    }

    // Handle network errors or json parsing errors
    logger.error(
      `Unexpected error fetching Keycloak certs for realm ${tenantKeycloakRealmId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw new InternalServerErrorException(
      `An unexpected error occurred while fetching Keycloak certificates for realm ${tenantKeycloakRealmId}.`,
    );
  }
}

export async function isAuthorized(request: Request): Promise<boolean> {
  logger.debug('Starting authorization check...');

  const configService = request.configService;
  const cacheService = request.cacheService;
  const tenant = request.tenant;

  if (!tenant) {
    logger.error(
      'Authorization check failed: Tenant data not found in request.',
    );
    throw new InternalServerErrorException(
      'Tenant configuration missing for authorization.',
    );
  }

  if (!tenant.keycloakRealmId) {
    logger.error(
      `Authorization check failed: keycloakRealmId is missing for tenant ID ${tenant.tenantId}.`,
    );
    throw new NotFoundException( // Or InternalServerErrorException if this is a critical config error
      `Keycloak realm configuration is missing for the current tenant (ID: ${tenant.tenantId}). Cannot verify token.`,
    );
  }

  const token = request.headers.authorization?.split(' ')[1]; // Bearer <token>
  if (!token) {
    logger.warn(
      'Authorization check failed: No authorization token (JWT) found in headers.',
    );
    throw new UnauthorizedException('Authorization token is missing.');
  }

  try {
    if (!cacheService) {
      logger.error(
        'CacheService not found on request object. Cannot proceed with cert fetching.',
      );
      throw new InternalServerErrorException(
        'Internal server configuration error: CacheService unavailable.',
      );
    }

    const authServerUrl = configService.get('KEYCLOAK_URL');
    if (!authServerUrl) {
      logger.error(
        `Authorization check failed: authServerUrl is missing for tenant ID ${tenant.tenantId}.`,
      );
      throw new InternalServerErrorException(
        `Keycloak auth server URL configuration is missing for tenant (ID: ${tenant.tenantId}).`,
      );
    }

    const decodedToken: any = jwt.decode(token, { complete: true });
    if (!decodedToken || !decodedToken.header || !decodedToken.header.kid) {
      logger.warn(
        'Authorization check failed: Invalid JWT format or missing KID in token header.',
      );
      throw new UnauthorizedException('Invalid token format.');
    }

    const certs = await getKeycloakCerts(
      tenant.keycloakRealmId,
      authServerUrl,
      cacheService,
    );

    const cert = certs.find(
      (c: KeycloakCert) => c.kid === decodedToken.header.kid,
    );
    if (!cert) {
      logger.warn(
        `Authorization check failed: No matching Keycloak certificate found for KID ${decodedToken.header.kid} in realm ${tenant.keycloakRealmId}.`,
      );
      throw new UnauthorizedException(
        'Token signing certificate not found. Token may be from an untrusted source or certs may be outdated.',
      );
    }

    // Convert KeycloakCert to JsonWebKey for use with crypto
    const jwk = cert as unknown as JsonWebKey;
    // Create a public key from the JWK
    const publicKey: KeyObject = createPublicKey({
      key: jwk,
      format: 'jwk',
    });
    const pem = publicKey.export({ type: 'spki', format: 'pem' });

    // Verify the token and get the payload
    const verifiedPayload = jwt.verify(token, pem, {
      algorithms: ['RS256'],
    }) as jwt.JwtPayload;

    // Populate req.user with details from the verified token.
    request.user = {
      id: verifiedPayload.sub as string,
    };

    logger.log(
      `User token successfully verified for realm ${tenant.keycloakRealmId}. User: ${request.user.id}`,
    );
    return true;
  } catch (error) {
    if (
      error instanceof jwt.JsonWebTokenError ||
      error instanceof jwt.TokenExpiredError ||
      error instanceof jwt.NotBeforeError
    ) {
      logger.warn(
        `JWT verification failed for realm ${tenant.keycloakRealmId}: ${error.message}`,
      );
      throw new UnauthorizedException(
        `Token verification failed: ${error.message}`,
      );
    }
    if (
      error instanceof UnauthorizedException ||
      error instanceof InternalServerErrorException ||
      error instanceof NotFoundException ||
      error instanceof ForbiddenException
    ) {
      // If it's already one of our specific HTTP exceptions, re-throw it
      throw error;
    }
    logger.error(
      `Unexpected error during token verification for realm ${tenant.keycloakRealmId}: ${error.message}`,
      error.stack,
    );
    throw new InternalServerErrorException(
      'An unexpected error occurred during token verification.',
    );
  }
}

// Function to construct Elasticsearch index name
export function getIndexName(headers: HeadersDto, index: string): string {
  const languageHeader = headers['accept-language'] ?? 'en';
  const tenantId = headers['x-tenant-id'] ?? undefined;

  // The accept-language header can be a comma-separated list.
  // Take the first, most preferred language and remove quality factors.
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Accept-Language
  const preferredLanguage = languageHeader.split(',')[0].trim();

  const langParts = preferredLanguage.toLowerCase().split('-');
  const baseLang = langParts[0];

  let finalLang = baseLang;

  if (langParts.length > 1) {
    const secondPart = langParts[1];
    // A second part of 4 letters is a script (e.g., Latn), which we keep.
    // A second part of 2 letters is a region (e.g., US), which we discard
    // to match base language indices (e.g., 'en' from 'en-US').
    if (secondPart.length === 4) {
      finalLang = `${baseLang}-${secondPart}`;
    }
  }
  // Sanitize the final locale for the index name (e.g., 'zh-hans' -> 'zh_hans')
  const sanitizedLanguage = finalLang.replace('-', '_');

  const indexName = `${tenantId}-${index}_${sanitizedLanguage}`;
  return indexName;
}
