import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GatewayPermissionsGuard } from './gateway-permissions.guard';
import { PermissionsSideChannelService } from './permissions-side-channel.service';

describe('GatewayPermissionsGuard', () => {
  let reflector: Reflector;
  let permissionsService: jest.Mocked<PermissionsSideChannelService>;
  let guard: GatewayPermissionsGuard;

  const buildContext = (request: any, isPublic = false): ExecutionContext => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(isPublic);
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    reflector = new Reflector();
    permissionsService = {
      resolveSlugs: jest.fn(),
    } as unknown as jest.Mocked<PermissionsSideChannelService>;
    guard = new GatewayPermissionsGuard(reflector, permissionsService);
  });

  it('@Public() route with no principal -> true, no fetch', async () => {
    const request: any = { authMode: undefined };
    const context = buildContext(request, true);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(permissionsService.resolveSlugs).not.toHaveBeenCalled();
  });

  it('authMode=legacy -> true, no fetch, gatewayPermissions left unset', async () => {
    const request: any = { authMode: 'legacy' };
    const context = buildContext(request);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(permissionsService.resolveSlugs).not.toHaveBeenCalled();
    expect(request.gatewayPermissions).toBeUndefined();
  });

  it('authMode=gateway with missing gatewayPrincipal -> propagates 401 from the service', async () => {
    const request: any = { authMode: 'gateway' };
    const context = buildContext(request);
    permissionsService.resolveSlugs.mockRejectedValue(
      new UnauthorizedException('gateway_identity_required'),
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('authMode=gateway -> resolves slugs and attaches req.gatewayPermissions', async () => {
    const request: any = {
      authMode: 'gateway',
      gatewayPrincipal: { externalId: 'tenant-a', keyId: 'key_123' },
    };
    const context = buildContext(request);
    permissionsService.resolveSlugs.mockResolvedValue(['norse-api.invoke']);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(permissionsService.resolveSlugs).toHaveBeenCalledWith('key_123');
    expect(request.gatewayPermissions).toEqual(['norse-api.invoke']);
  });

  it('service throw (503) propagates, is not converted to true', async () => {
    const request: any = {
      authMode: 'gateway',
      gatewayPrincipal: { externalId: 'tenant-a', keyId: 'key_123' },
    };
    const context = buildContext(request);
    permissionsService.resolveSlugs.mockRejectedValue(new Error('boom'));

    await expect(guard.canActivate(context)).rejects.toThrow('boom');
  });
});
