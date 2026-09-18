import {
  BadRequestException,
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PUBLIC_KEY } from './gateway-principal';
import { requiredSlug, resolveTargetTenant } from './tenant-scope.util';

const PLATFORM_ADMIN_SLUG = 'norse-api.admin';

/**
 * Cross-checks a gateway-path request's permission slugs against
 * the target NORSE Tenant taken from the request, per HTTP verb.
 * Runs last in the APP_GUARD chain:
 * GatewayIdentityGuard -> GatewayPermissionsGuard -> TenantScopeGuard
 * (this guard depends on both predecessors having run).
 */
@Injectable()
export class TenantScopeGuard implements CanActivate {
  private readonly logger = new Logger(TenantScopeGuard.name);
  private readonly auditLogger = new Logger('TenantScopeAudit');

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

    if (request.authMode !== 'gateway') {
      return true;
    }

    if (request.method.toUpperCase() === 'OPTIONS') {
      return true;
    }

    if (!request.gatewayPrincipal) {
      throw new UnauthorizedException('gateway_identity_required');
    }
    if (!request.gatewayPermissions) {
      throw new ServiceUnavailableException('permissions_unavailable');
    }

    let target: string | undefined;
    try {
      target = resolveTargetTenant(request);
    } catch (err) {
      this.warnDeny(request, this.deniedReasonFromException(err));
      throw err;
    }

    const isPlatformBypass =
      request.gatewayPermissions.includes(PLATFORM_ADMIN_SLUG);

    if (target === undefined && !isPlatformBypass) {
      this.warnDeny(request, 'target_required');
      throw new BadRequestException('tenant_target_required');
    }

    if (target !== undefined) {
      request.targetTenantId = target;
      // Feed the exception filter's `tenant` field with the resolved
      // gateway target (mirrors what TenantMiddleware does for req.tenantId
      // on the legacy path).
      request.tenantId = target;
    }

    if (isPlatformBypass) {
      this.auditLogger.log({
        event: 'platform_bypass',
        externalId: request.gatewayPrincipal.externalId,
        keyId: request.gatewayPrincipal.keyId,
        method: request.method,
        path: request.originalUrl,
        target: target ?? 'none',
        timestamp: Date.now(),
      });
      return true;
    }

    const slug = requiredSlug(target, request.method);
    if (!request.gatewayPermissions.includes(slug)) {
      this.warnDeny(request, 'scope_denied', target);
      throw new ForbiddenException('tenant_scope_denied');
    }

    this.logger.debug(
      `Tenant scope pass: keyId=${request.gatewayPrincipal.keyId} target=${target} verb=${slug.endsWith('.write') ? 'write' : 'read'}`,
    );

    return true;
  }

  private deniedReasonFromException(
    err: unknown,
  ): 'target_invalid' | 'target_mismatch' {
    if (err instanceof BadRequestException) {
      const message = (err.getResponse() as any)?.message;
      if (message === 'tenant_target_mismatch') {
        return 'target_mismatch';
      }
    }
    return 'target_invalid';
  }

  private warnDeny(
    request: Request,
    result:
      'target_required' | 'target_invalid' | 'target_mismatch' | 'scope_denied',
    target?: string,
  ) {
    this.logger.warn(
      `Tenant scope deny: method=${request.method} path=${request.originalUrl} result=${result} keyId=${request.gatewayPrincipal?.keyId}${target ? ` target=${target}` : ''}`,
    );
  }
}
