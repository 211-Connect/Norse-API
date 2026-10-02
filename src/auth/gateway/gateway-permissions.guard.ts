import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PUBLIC_KEY } from './gateway-principal';
import { PermissionsSideChannelService } from './permissions-side-channel.service';

/**
 * Resolves req.gatewayPermissions from the permissions side-channel.
 * Runs after GatewayIdentityGuard in the APP_GUARD registration order.
 *
 * Dual-mode skip: a legacy request (req.authMode !== 'gateway') was never gateway-authenticated,
 * so this guard makes no fetch and defers entirely to KeycloakGuard/TenantMiddleware/controller-level
 * checks already running on that path.
 */
@Injectable()
export class GatewayPermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsSideChannelService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();

    if (request.authMode !== 'gateway') {
      return true;
    }

    request.gatewayPermissions = await this.permissionsService.resolveSlugs(
      request.gatewayPrincipal?.keyId,
    );

    return true;
  }
}
