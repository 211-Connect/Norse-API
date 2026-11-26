import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GatewayOrInternalKeyGuard } from './gateway-or-internal-key.guard';

const ctx = (req: Record<string, unknown>) =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;

const make = (internalApiKey: string | undefined = 'secret') =>
  new GatewayOrInternalKeyGuard({
    get: (k: string) => (k === 'internalApiKey' ? internalApiKey : undefined),
  } as unknown as ConfigService);

const noKey = { headers: {}, method: 'GET', path: '/internal/regions' };
const gateway = { ...noKey, authMode: 'gateway', gatewayPermissions: [] };

describe('GatewayOrInternalKeyGuard', () => {
  it('passes a gateway-authenticated request without the internal key', () => {
    expect(make().canActivate(ctx(gateway))).toBe(true);
  });

  it('passes a gateway-authenticated request when INTERNAL_API_KEY is unset', () => {
    expect(make(undefined).canActivate(ctx(gateway))).toBe(true);
  });

  it('passes the internal key without gateway identity', () => {
    const req = { ...noKey, headers: { 'x-internal-api-key': 'secret' } };
    expect(make().canActivate(ctx(req))).toBe(true);
  });

  it.each([
    ['no credential', noKey],
    ['a wrong key', { ...noKey, headers: { 'x-internal-api-key': 'bad' } }],
    // Identity headers alone, with no permissions resolved, are not the gateway.
    ['gateway mode without permissions', { ...noKey, authMode: 'gateway' }],
    ['legacy mode', { ...noKey, authMode: 'legacy' }],
  ])('401s on %s', (_label, req) => {
    expect(() => make().canActivate(ctx(req))).toThrow(UnauthorizedException);
  });

  it('fails closed without gateway identity when INTERNAL_API_KEY is unset', () => {
    for (const key of [undefined, '']) {
      const req = { ...noKey, headers: { 'x-internal-api-key': 'anything' } };
      expect(() => make(key).canActivate(ctx(req))).toThrow(
        UnauthorizedException,
      );
    }
  });
});
