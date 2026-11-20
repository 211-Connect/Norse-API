import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
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
 * A request with neither credential gets 401 only when `TENANT_CONFIG_KEY_ENFORCE`
 * is exactly `true`. Default (Lucas, 2026-11-20): off = log a warning and allow,
 * so a merge does not break unknown direct-host callers. Flip after the caller
 * list (Keeper, mobile) is confirmed.
 */
@Injectable()
export class InternalKeyOrGatewayGuard implements CanActivate {
  private readonly logger = new Logger(InternalKeyOrGatewayGuard.name);
  private readonly internalApiGuard: InternalApiGuard;
  private readonly enforce: boolean;

  constructor(configService: ConfigService) {
    this.internalApiGuard = new InternalApiGuard(configService);
    this.enforce =
      configService.get<string>('TENANT_CONFIG_KEY_ENFORCE')?.trim() === 'true';
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (request.authMode === 'gateway' && request.gatewayPermissions) {
      return true;
    }

    try {
      return this.internalApiGuard.canActivate(context);
    } catch {
      if (!this.enforce) {
        this.logger.warn(
          `Allowed ${request.method} ${request.path} without a valid internal key or gateway identity (TENANT_CONFIG_KEY_ENFORCE is off)`,
        );
        return true;
      }
      throw new UnauthorizedException(
        'Gateway identity or internal API key required',
      );
    }
  }
}
