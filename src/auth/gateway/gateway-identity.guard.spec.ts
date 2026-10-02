import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GatewayIdentityGuard } from './gateway-identity.guard';

describe('GatewayIdentityGuard', () => {
  let guard: GatewayIdentityGuard;
  let reflector: Reflector;

  const buildContext = (
    headers: Record<string, string>,
    isPublic = false,
  ): { context: ExecutionContext; request: any } => {
    const lowered: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      lowered[key.toLowerCase()] = value;
    }

    const request: any = {
      headers: lowered,
      method: 'GET',
      originalUrl: '/taxonomy',
      get(name: string) {
        return this.headers[name.toLowerCase()];
      },
    };

    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(isPublic);

    return { context, request };
  };

  beforeEach(() => {
    reflector = new Reflector();
    guard = new GatewayIdentityGuard(reflector);
  });

  it('sets authMode=gateway and gatewayPrincipal when both headers present', () => {
    const { context, request } = buildContext({
      'x-connect211-identity-external-id': ' tenant-abc ',
      'x-connect211-key-id': ' key_123 ',
    });

    expect(guard.canActivate(context)).toBe(true);
    expect(request.authMode).toBe('gateway');
    expect(request.gatewayPrincipal).toEqual({
      externalId: 'tenant-abc',
      keyId: 'key_123',
    });
  });

  it.each([
    ['missing external-id', { 'x-connect211-key-id': 'key_123' }],
    ['missing key-id', { 'x-connect211-identity-external-id': 'tenant-abc' }],
    ['both missing', {}],
    [
      'empty external-id',
      {
        'x-connect211-identity-external-id': '',
        'x-connect211-key-id': 'key_123',
      },
    ],
    [
      'whitespace-only key-id',
      {
        'x-connect211-identity-external-id': 'tenant-abc',
        'x-connect211-key-id': '   ',
      },
    ],
  ])('%s -> authMode=legacy, no throw, no principal', (_label, headers) => {
    const { context, request } = buildContext(headers);

    expect(() => guard.canActivate(context)).not.toThrow();
    expect(guard.canActivate(context)).toBe(true);
    expect(request.authMode).toBe('legacy');
    expect(request.gatewayPrincipal).toBeUndefined();
  });

  it('Authorization Bearer alone routes to legacy path', () => {
    const { context, request } = buildContext({
      authorization: 'Bearer looks.valid.jwt',
    });

    expect(guard.canActivate(context)).toBe(true);
    expect(request.authMode).toBe('legacy');
    expect(request.gatewayPrincipal).toBeUndefined();
  });

  it('X-API-Key alone (no gateway headers, no Authorization) routes to legacy, key ignored', () => {
    const { context, request } = buildContext({
      'x-api-key': 'sk_something',
    });

    expect(guard.canActivate(context)).toBe(true);
    expect(request.authMode).toBe('legacy');
    expect(request.gatewayPrincipal).toBeUndefined();
  });

  it('gateway headers + X-API-Key present -> gateway path, key ignored', () => {
    const { context, request } = buildContext({
      'x-connect211-identity-external-id': 'tenant-abc',
      'x-connect211-key-id': 'key_123',
      'x-api-key': 'sk_something',
    });

    expect(guard.canActivate(context)).toBe(true);
    expect(request.authMode).toBe('gateway');
    expect(request.gatewayPrincipal).toEqual({
      externalId: 'tenant-abc',
      keyId: 'key_123',
    });
  });

  it('forged X-Connect211-Permissions / X-Unkey-Principal alone -> legacy (extras ignored)', () => {
    const { context, request } = buildContext({
      'x-connect211-permissions': 'norse-api.admin',
      'x-unkey-principal': 'forged',
    });

    expect(guard.canActivate(context)).toBe(true);
    expect(request.authMode).toBe('legacy');
    expect(request.gatewayPrincipal).toBeUndefined();
  });

  it('@Public() route with no headers -> true, no authMode enforcement needed', () => {
    const { context } = buildContext({}, true);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('uppercase header names are matched case-insensitively', () => {
    const { context, request } = buildContext({
      'X-CONNECT211-IDENTITY-EXTERNAL-ID': 'tenant-abc',
      'X-CONNECT211-KEY-ID': 'key_123',
    });

    expect(guard.canActivate(context)).toBe(true);
    expect(request.authMode).toBe('gateway');
  });
});
