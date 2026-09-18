/**
 * Shared Swagger `description` text for headers documented on multiple
 * controllers, so the two post-migration roles of `x-tenant-id` (ticket 04
 * §R3) are described consistently everywhere the header appears.
 */
export const X_TENANT_ID_HEADER_DESCRIPTION =
  'NORSE Tenant UUID. On the legacy path it is validated by TenantMiddleware; ' +
  'on gateway-routed requests the same value is also the target-tenant ' +
  "selector checked against the caller's permission slugs by TenantScopeGuard.";
