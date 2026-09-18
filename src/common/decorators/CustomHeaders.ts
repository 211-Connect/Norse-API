import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * On the gateway path, req.targetTenantId is the guard-verified
 * target tenant - the same value TenantScopeGuard's scope check ran against.
 * Every tenant-data controller resolves its query tenant from the
 * full headers object this decorator returns, so overriding x-tenant-id
 * here (rather than at each call site) is what makes `WHERE tenant_id = req.targetTenantId`
 * binding hold for all of them at once. On the legacy path req.targetTenantId is never set,
 * so this is a no-op and req.headers passes through unchanged.
 */
export function customHeadersFactory(data: any, ctx: ExecutionContext) {
  const req = ctx.switchToHttp().getRequest();
  if (data) {
    return req.headers[data];
  }
  if (req.targetTenantId) {
    return { ...req.headers, 'x-tenant-id': req.targetTenantId };
  }
  return req.headers;
}

export const CustomHeaders = createParamDecorator(customHeadersFactory);
