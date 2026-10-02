import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import {
  GATEWAY_EXTERNAL_ID_HEADER,
  GATEWAY_EXTERNAL_ID_MAX_LENGTH,
  GATEWAY_KEY_ID_HEADER,
  GATEWAY_KEY_ID_MAX_LENGTH,
  PUBLIC_KEY,
} from './gateway-principal';
import { Logger } from '@nestjs/common';

/**
 * Resolves req.authMode ('gateway' | 'legacy') for every request.
 *
 * Dual-mode: the client-side gateway migration is incremental, so this guard never denies
 * — a request without a complete gateway header pair is classified 'legacy'
 * and falls through to whatever guards/middleware already protect that route
 * (KeycloakGuard, TenantMiddleware, InternalApiGuard, AnalyticsApiKeyGuard).
 */
@Injectable()
export class GatewayIdentityGuard implements CanActivate {
  private readonly logger = new Logger(GatewayIdentityGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();

    const externalId = this.readHeader(
      request,
      GATEWAY_EXTERNAL_ID_HEADER,
      GATEWAY_EXTERNAL_ID_MAX_LENGTH,
    );
    const keyId = this.readHeader(
      request,
      GATEWAY_KEY_ID_HEADER,
      GATEWAY_KEY_ID_MAX_LENGTH,
    );

    if (externalId && keyId) {
      request.authMode = 'gateway';
      request.gatewayPrincipal = { externalId, keyId };
      this.logger.debug(
        `Gateway identity resolved for ${request.method} ${request.originalUrl}`,
      );
      return true;
    }

    request.authMode = 'legacy';

    const missing =
      !externalId && !keyId ? 'both' : !externalId ? 'external-id' : 'key-id';
    this.logger.debug(
      `No gateway identity (missing: ${missing}) for ${request.method} ${request.originalUrl}, routing to legacy path`,
    );

    return true;
  }

  private readHeader(
    request: Request,
    name: string,
    maxLength: number,
  ): string | undefined {
    const raw = request.get(name);
    if (typeof raw !== 'string') {
      return undefined;
    }
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > maxLength) {
      return undefined;
    }
    return trimmed;
  }
}
