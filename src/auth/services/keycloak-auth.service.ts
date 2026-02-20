import {
  Injectable,
  Logger,
  InternalServerErrorException,
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import { createPublicKey, JsonWebKey, KeyObject } from 'crypto';
import { Cache } from 'cache-manager';
import { Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { TenantConfigService } from 'src/cms-config/tenant-config.service';

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

/**
 * Service responsible for Keycloak-based authentication
 * Fetches keycloakRealmId from Redis/Strapi via TenantConfigService
 */
@Injectable()
export class KeycloakAuthService {
  private readonly logger = new Logger(KeycloakAuthService.name);

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheService: Cache,
    private readonly configService: ConfigService,
    private readonly tenantConfigService: TenantConfigService,
  ) {}

  /**
   * Verify if the request is authorized based on JWT token
   */
  async isAuthorized(request: Request): Promise<boolean> {
    this.logger.debug('Starting authorization check...');

    const tenantId = request.tenantId;

    if (!tenantId) {
      this.logger.error(
        'Authorization check failed: Tenant ID not found in request.',
      );
      throw new InternalServerErrorException(
        'Tenant ID missing for authorization.',
      );
    }

    const token = request.headers.authorization?.split(' ')[1]; // Bearer <token>
    if (!token) {
      this.logger.warn(
        'Authorization check failed: No authorization token (JWT) found in headers.',
      );
      throw new UnauthorizedException('Authorization token is missing.');
    }

    try {
      // Fetch keycloakRealmId from Redis DB 2 or Strapi
      const keycloakRealmId =
        await this.tenantConfigService.getKeycloakRealmId(tenantId);

      if (!keycloakRealmId) {
        this.logger.error(
          `Authorization check failed: keycloakRealmId is missing for tenant ID ${tenantId}.`,
        );
        throw new NotFoundException(
          `Keycloak realm configuration is missing for the current tenant (ID: ${tenantId}). Cannot verify token.`,
        );
      }

      const authServerUrl = this.configService.get('KEYCLOAK_URL');
      if (!authServerUrl) {
        this.logger.error(
          `Authorization check failed: authServerUrl is missing for tenant ID ${tenantId}.`,
        );
        throw new InternalServerErrorException(
          `Keycloak auth server URL configuration is missing for tenant (ID: ${tenantId}).`,
        );
      }

      const decodedToken: any = jwt.decode(token, { complete: true });
      if (!decodedToken || !decodedToken.header || !decodedToken.header.kid) {
        this.logger.warn(
          'Authorization check failed: Invalid JWT format or missing KID in token header.',
        );
        throw new UnauthorizedException('Invalid token format.');
      }

      const certs = await this.getKeycloakCerts(keycloakRealmId, authServerUrl);

      const cert = certs.find(
        (c: KeycloakCert) => c.kid === decodedToken.header.kid,
      );
      if (!cert) {
        this.logger.warn(
          `Authorization check failed: No matching Keycloak certificate found for KID ${decodedToken.header.kid} in realm ${keycloakRealmId}.`,
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

      this.logger.log(
        `User token successfully verified for realm ${keycloakRealmId}. User: ${request.user.id}`,
      );
      return true;
    } catch (error) {
      if (
        error instanceof jwt.JsonWebTokenError ||
        error instanceof jwt.TokenExpiredError ||
        error instanceof jwt.NotBeforeError
      ) {
        this.logger.warn(`JWT verification failed: ${error.message}`);
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
      this.logger.error(
        `Unexpected error during token verification: ${error.message}`,
        error instanceof Error ? error.stack : '',
      );
      throw new InternalServerErrorException(
        'An unexpected error occurred during token verification.',
      );
    }
  }

  /**
   * Fetch Keycloak certificates for token verification
   */
  private async getKeycloakCerts(
    tenantKeycloakRealmId: string,
    authServerUrl: string,
  ): Promise<KeycloakCertsResponse['keys']> {
    const cacheKey = `keycloak:${tenantKeycloakRealmId}`;
    const cachedCerts =
      await this.cacheService.get<KeycloakCertsResponse['keys']>(cacheKey);

    if (cachedCerts) {
      this.logger.debug(
        `Using cached Keycloak certs for realm: ${tenantKeycloakRealmId}`,
      );
      return cachedCerts;
    }

    const certsUrl = `${authServerUrl}/realms/${tenantKeycloakRealmId}/protocol/openid-connect/certs`;
    this.logger.log(`Fetching Keycloak certs from: ${certsUrl}`);

    try {
      const response = await fetch(certsUrl);
      if (!response.ok) {
        this.logger.error(
          `Failed to fetch Keycloak certs. Status: ${response.status} ${response.statusText}`,
        );
        throw new InternalServerErrorException(
          `Failed to retrieve Keycloak certificates for realm ${tenantKeycloakRealmId}. Service may be temporarily unavailable (Status: ${response.status}).`,
        );
      }

      const data: KeycloakCertsResponse = await response.json();

      if (!data || !data.keys || data.keys.length === 0) {
        this.logger.error(
          `No Keycloak certs found at ${certsUrl} for realm ${tenantKeycloakRealmId}`,
        );
        throw new InternalServerErrorException(
          `Keycloak certs configuration error for realm ${tenantKeycloakRealmId}.`,
        );
      }

      // Cache with TTL 0 (never expire) - Keycloak certs are relatively stable
      await this.cacheService.set(cacheKey, data.keys, 0);
      this.logger.log(
        `Successfully fetched and cached Keycloak certs for realm: ${tenantKeycloakRealmId}`,
      );
      return data.keys;
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }

      // Handle network errors or json parsing errors
      this.logger.error(
        `Unexpected error fetching Keycloak certs for realm ${tenantKeycloakRealmId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new InternalServerErrorException(
        `An unexpected error occurred while fetching Keycloak certificates for realm ${tenantKeycloakRealmId}.`,
      );
    }
  }
}
