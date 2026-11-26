import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { InternalApiGuard } from './internal-api.guard';

/**
 * Allows a request the gateway authenticated, or one that carries a valid
 * `x-internal-api-key`. Anything else is 401: it fails closed, unlike
 * InternalKeyOrGatewayGuard, which only warns until TENANT_CONFIG_KEY_ENFORCE is on.
 *
 * "Gateway authenticated" means GatewayIdentityGuard set authMode 'gateway' and
 * GatewayPermissionsGuard resolved the key's permissions from the side channel.
 * Both are APP_GUARDs and run first. c211-auth lets a key through to Norse-API only
 * when it holds `norse-api.invoke`, and a forged identity header on a direct host
 * (api.c211.io) fails in GatewayPermissionsGuard, because the side channel does not
 * know the key. On a direct host the internal key stays the only way in.
 */
@Injectable()
export class GatewayOrInternalKeyGuard implements CanActivate {
  private readonly internalApiGuard: InternalApiGuard;

  constructor(configService: ConfigService) {
    this.internalApiGuard = new InternalApiGuard(configService);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.authMode === 'gateway' && request.gatewayPermissions) {
      return true;
    }
    try {
      return this.internalApiGuard.canActivate(context);
    } catch {
      throw new UnauthorizedException(
        'Gateway API key or internal API key required',
      );
    }
  }
}
