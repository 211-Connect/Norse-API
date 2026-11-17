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
 * Allows a request that carries a valid `x-internal-api-key`, or one that the
 * gateway authenticated.
 *
 * "Gateway authenticated" means GatewayIdentityGuard set authMode 'gateway' and
 * GatewayPermissionsGuard resolved the key's permissions from the side channel.
 * Both are APP_GUARDs and run first. A forged identity header on a direct host
 * (api.c211.io) fails there with 401, because the side channel does not know the key.
 * A request with neither credential gets 401.
 */
@Injectable()
export class InternalKeyOrGatewayGuard implements CanActivate {
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
        'Gateway identity or internal API key required',
      );
    }
  }
}
