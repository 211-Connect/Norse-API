import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantScopeGuard } from './tenant-scope.guard';

const TENANT_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

describe('TenantScopeGuard', () => {
  let reflector: Reflector;
  let guard: TenantScopeGuard;
  let auditLogSpy: jest.SpyInstance;

  const buildRequest = (overrides: Record<string, any> = {}) => {
    const headers: Record<string, string> = overrides.headers ?? {};
    return {
      method: overrides.method ?? 'GET',
      originalUrl: overrides.originalUrl ?? '/taxonomy',
      headers,
      get(name: string) {
        return this.headers[name.toLowerCase()];
      },
      authMode: overrides.authMode ?? 'gateway',
      gatewayPrincipal: overrides.gatewayPrincipal,
      gatewayPermissions: overrides.gatewayPermissions,
      tenantId: overrides.tenantId,
      body: overrides.body,
      query: overrides.query ?? {},
      params: overrides.params ?? {},
    } as any;
  };

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
    guard = new TenantScopeGuard(reflector);
    auditLogSpy = jest
      .spyOn((guard as any).auditLogger, 'log')
      .mockImplementation(() => undefined);
  });

  it('read with matching scope -> true, req.targetTenantId set (lowercased)', () => {
    const request = buildRequest({
      headers: { 'x-tenant-id': TENANT_A },
      gatewayPrincipal: { externalId: 'tenant-a', keyId: 'key_1' },
      gatewayPermissions: ['norse-api.invoke', `norse-api.${TENANT_A}.read`],
    });
    const context = buildContext(request);

    expect(guard.canActivate(context)).toBe(true);
    expect(request.targetTenantId).toBe(TENANT_A);
  });

  it('read with scope for a different tenant -> 403 tenant_scope_denied', () => {
    const request = buildRequest({
      headers: { 'x-tenant-id': TENANT_A },
      gatewayPrincipal: { externalId: 'tenant-a', keyId: 'key_1' },
      gatewayPermissions: [`norse-api.${TENANT_B}.read`],
    });
    const context = buildContext(request);

    expect(() => guard.canActivate(context)).toThrow('tenant_scope_denied');
  });

  it('write with only .read -> 403 (read does not satisfy write)', () => {
    const request = buildRequest({
      method: 'POST',
      headers: { 'x-tenant-id': TENANT_A },
      gatewayPrincipal: { externalId: 'tenant-a', keyId: 'key_1' },
      gatewayPermissions: [`norse-api.${TENANT_A}.read`],
    });
    const context = buildContext(request);

    expect(() => guard.canActivate(context)).toThrow('tenant_scope_denied');
  });

  it('write with .write (no .read) -> true (literal match, no OR logic)', () => {
    const request = buildRequest({
      method: 'PUT',
      headers: { 'x-tenant-id': TENANT_A },
      gatewayPrincipal: { externalId: 'tenant-a', keyId: 'key_1' },
      gatewayPermissions: [`norse-api.${TENANT_A}.write`],
    });
    const context = buildContext(request);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('truncated UUID header -> 400 tenant_target_invalid', () => {
    const request = buildRequest({
      headers: { 'x-tenant-id': '11111111-1111-4111-8111' },
      gatewayPrincipal: { externalId: 'tenant-a', keyId: 'key_1' },
      gatewayPermissions: ['norse-api.invoke'],
    });
    const context = buildContext(request);

    expect(() => guard.canActivate(context)).toThrow('tenant_target_invalid');
  });

  it('not-a-uuid header -> 400 tenant_target_invalid', () => {
    const request = buildRequest({
      headers: { 'x-tenant-id': 'not-a-uuid' },
      gatewayPrincipal: { externalId: 'tenant-a', keyId: 'key_1' },
      gatewayPermissions: ['norse-api.invoke'],
    });
    const context = buildContext(request);

    expect(() => guard.canActivate(context)).toThrow('tenant_target_invalid');
  });

  it('uppercase UUID header with whitespace -> passes after trim/lowercase', () => {
    const request = buildRequest({
      headers: { 'x-tenant-id': `  ${TENANT_A.toUpperCase()}  ` },
      gatewayPrincipal: { externalId: 'tenant-a', keyId: 'key_1' },
      gatewayPermissions: [`norse-api.${TENANT_A}.read`],
    });
    const context = buildContext(request);

    expect(guard.canActivate(context)).toBe(true);
    expect(request.targetTenantId).toBe(TENANT_A);
  });

  it('slug with uppercase/truncated UUID never matches target -> 403', () => {
    const request = buildRequest({
      headers: { 'x-tenant-id': TENANT_A },
      gatewayPrincipal: { externalId: 'tenant-a', keyId: 'key_1' },
      gatewayPermissions: [`norse-api.${TENANT_A.toUpperCase()}.read`],
    });
    const context = buildContext(request);

    expect(() => guard.canActivate(context)).toThrow('tenant_scope_denied');
  });

  it('header vs req.tenantId mismatch -> 400 tenant_target_mismatch', () => {
    const request = buildRequest({
      headers: { 'x-tenant-id': TENANT_A },
      tenantId: TENANT_B,
      gatewayPrincipal: { externalId: 'tenant-a', keyId: 'key_1' },
      gatewayPermissions: ['norse-api.invoke'],
    });
    const context = buildContext(request);

    expect(() => guard.canActivate(context)).toThrow('tenant_target_mismatch');
  });

  it('missing x-tenant-id and no req.tenantId, non-admin -> 400 tenant_target_required', () => {
    const request = buildRequest({
      gatewayPrincipal: { externalId: 'tenant-a', keyId: 'key_1' },
      gatewayPermissions: ['norse-api.invoke'],
    });
    const context = buildContext(request);

    expect(() => guard.canActivate(context)).toThrow('tenant_target_required');
  });

  it('norse-api.admin + target -> true, one audit line with platform principal', () => {
    const request = buildRequest({
      headers: { 'x-tenant-id': TENANT_A },
      gatewayPrincipal: { externalId: 'platform-connect-211', keyId: 'key_p' },
      gatewayPermissions: ['norse-api.admin'],
    });
    const context = buildContext(request);

    expect(guard.canActivate(context)).toBe(true);
    expect(request.targetTenantId).toBe(TENANT_A);
    expect(auditLogSpy).toHaveBeenCalledTimes(1);
    expect(auditLogSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'platform_bypass',
        externalId: 'platform-connect-211',
        target: TENANT_A,
      }),
    );
  });

  it('norse-api.admin + no target -> true, target: none, audit line (tenant-less exception)', () => {
    const request = buildRequest({
      gatewayPrincipal: { externalId: 'platform-connect-211', keyId: 'key_p' },
      gatewayPermissions: ['norse-api.admin'],
    });
    const context = buildContext(request);

    expect(guard.canActivate(context)).toBe(true);
    expect(request.targetTenantId).toBeUndefined();
    expect(auditLogSpy).toHaveBeenCalledWith(
      expect.objectContaining({ target: 'none' }),
    );
  });

  it('non-admin externalId presenting norse-api.admin still bypasses (slug-checked, not externalId-checked)', () => {
    const request = buildRequest({
      headers: { 'x-tenant-id': TENANT_A },
      gatewayPrincipal: { externalId: 'tenant-a', keyId: 'key_1' },
      gatewayPermissions: ['norse-api.admin'],
    });
    const context = buildContext(request);

    expect(guard.canActivate(context)).toBe(true);
    expect(auditLogSpy).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'tenant-a' }),
    );
  });

  it('norse-api.invoke alone (no per-tenant, no admin) -> 403 on a tenant route', () => {
    const request = buildRequest({
      headers: { 'x-tenant-id': TENANT_A },
      gatewayPrincipal: { externalId: 'tenant-a', keyId: 'key_1' },
      gatewayPermissions: ['norse-api.invoke'],
    });
    const context = buildContext(request);

    expect(() => guard.canActivate(context)).toThrow('tenant_scope_denied');
  });

  it('body/path/query tenant ignored - target comes from x-tenant-id header only', () => {
    const request = buildRequest({
      headers: { 'x-tenant-id': TENANT_A },
      body: { tenantId: TENANT_B },
      query: { tid: TENANT_B },
      params: { tenantId: TENANT_B },
      gatewayPrincipal: { externalId: 'tenant-a', keyId: 'key_1' },
      gatewayPermissions: [`norse-api.${TENANT_A}.read`],
    });
    const context = buildContext(request);

    expect(guard.canActivate(context)).toBe(true);
    expect(request.targetTenantId).toBe(TENANT_A);
  });

  it('@Public() route with no headers/permissions -> true, no throw', () => {
    const request = buildRequest({});
    const context = buildContext(request, true);

    expect(() => guard.canActivate(context)).not.toThrow();
    expect(guard.canActivate(context)).toBe(true);
  });

  it('authMode=legacy -> true immediately; no target resolution, no audit log', () => {
    const request = buildRequest({ authMode: 'legacy' });
    const context = buildContext(request);

    expect(guard.canActivate(context)).toBe(true);
    expect(request.targetTenantId).toBeUndefined();
    expect(auditLogSpy).not.toHaveBeenCalled();
  });

  it('OPTIONS without headers -> true (preflight skip)', () => {
    const request = buildRequest({
      method: 'OPTIONS',
      gatewayPrincipal: { externalId: 'tenant-a', keyId: 'key_1' },
      gatewayPermissions: [],
    });
    const context = buildContext(request);

    expect(guard.canActivate(context)).toBe(true);
    expect(request.targetTenantId).toBeUndefined();
  });

  it('missing gatewayPrincipal while authMode=gateway -> 401', () => {
    const request = buildRequest({ gatewayPrincipal: undefined });
    const context = buildContext(request);

    expect(() => guard.canActivate(context)).toThrow(
      'gateway_identity_required',
    );
  });

  it('missing gatewayPermissions while authMode=gateway -> 503', () => {
    const request = buildRequest({
      gatewayPrincipal: { externalId: 'tenant-a', keyId: 'key_1' },
      gatewayPermissions: undefined,
    });
    const context = buildContext(request);

    expect(() => guard.canActivate(context)).toThrow('permissions_unavailable');
  });

  it('non-UUID permission slug segment (e.g. PayloadCMS slug) never satisfies target -> 403', () => {
    const request = buildRequest({
      headers: { 'x-tenant-id': TENANT_A },
      gatewayPrincipal: { externalId: 'tenant-a', keyId: 'key_1' },
      gatewayPermissions: ['norse-api.md211.read'],
    });
    const context = buildContext(request);

    expect(() => guard.canActivate(context)).toThrow('tenant_scope_denied');
  });
});
