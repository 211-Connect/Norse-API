import { ApiQuery } from '@nestjs/swagger';

/**
 * Documents the optional `tenant_id` query parameter enforced by TenantMiddleware.
 *
 * Added for a URL-keyed CDN that is no longer in use; kept for compatibility.
 * When present, it must exactly match the `x-tenant-id` header, or the
 * request is rejected with 400 Bad Request.
 */
export const ApiTenantIdQuery = () =>
  ApiQuery({
    name: 'tenant_id',
    required: false,
    description:
      'Optional mirror of the x-tenant-id header. If provided, must exactly match x-tenant-id or the request is rejected with 400.',
    schema: { type: 'string' },
  });
