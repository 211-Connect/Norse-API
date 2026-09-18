import { ExecutionContext } from '@nestjs/common';
import { customHeadersFactory } from './CustomHeaders';

describe('customHeadersFactory', () => {
  const buildContext = (request: any): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  it('with a data key, returns that single header (legacy behavior unchanged)', () => {
    const request = { headers: { 'x-tenant-id': 'raw-value' } };
    expect(customHeadersFactory('x-tenant-id', buildContext(request))).toBe(
      'raw-value',
    );
  });

  it('without data and no targetTenantId (legacy path), returns req.headers unchanged', () => {
    const request = {
      headers: { 'x-tenant-id': 'raw-value', 'accept-language': 'en' },
    };
    expect(customHeadersFactory(undefined, buildContext(request))).toBe(
      request.headers,
    );
  });

  it('without data and req.targetTenantId set (gateway path), overrides x-tenant-id with the guard-verified target', () => {
    const request = {
      headers: { 'x-tenant-id': 'raw-value', 'accept-language': 'en' },
      targetTenantId: 'aaaaaaaa-1111-4111-8111-111111111111',
    };
    const result = customHeadersFactory(undefined, buildContext(request));
    expect(result).toEqual({
      'x-tenant-id': 'aaaaaaaa-1111-4111-8111-111111111111',
      'accept-language': 'en',
    });
  });
});
