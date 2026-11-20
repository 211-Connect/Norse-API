import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalKeyOrGatewayGuard } from './internal-key-or-gateway.guard';

const ctx = (req: Record<string, unknown>) =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;

const make = (enforce?: string) =>
  new InternalKeyOrGatewayGuard({
    get: (k: string) =>
      ({ internalApiKey: 'secret', TENANT_CONFIG_KEY_ENFORCE: enforce })[k],
  } as unknown as ConfigService);

const noKey = { headers: {}, method: 'GET', path: '/tenant-config/t/topics' };

describe('InternalKeyOrGatewayGuard', () => {
  it('valid key passes in both modes', () => {
    const req = { ...noKey, headers: { 'x-internal-api-key': 'secret' } };
    expect(make().canActivate(ctx(req))).toBe(true);
    expect(make('true').canActivate(ctx(req))).toBe(true);
  });

  it('gateway identity passes in both modes', () => {
    const req = { ...noKey, authMode: 'gateway', gatewayPermissions: {} };
    expect(make().canActivate(ctx(req))).toBe(true);
    expect(make('true').canActivate(ctx(req))).toBe(true);
  });

  it.each([undefined, '', 'false', 'TRUE', '1'])(
    'enforce %p: missing key is allowed (warn only)',
    (value) => {
      expect(make(value).canActivate(ctx(noKey))).toBe(true);
    },
  );

  it('enforce off: a wrong key is allowed too', () => {
    const req = { ...noKey, headers: { 'x-internal-api-key': 'bad' } };
    expect(make().canActivate(ctx(req))).toBe(true);
  });

  it('enforce true: missing or wrong key is 401', () => {
    expect(() => make('true').canActivate(ctx(noKey))).toThrow(
      UnauthorizedException,
    );
    const bad = { ...noKey, headers: { 'x-internal-api-key': 'bad' } };
    expect(() => make('true').canActivate(ctx(bad))).toThrow(
      UnauthorizedException,
    );
  });
});
