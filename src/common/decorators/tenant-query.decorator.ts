import { ApiQuery } from '@nestjs/swagger';

/**
 * Documents the optional `tenant_id` query parameter enforced by TenantMiddleware.
 *
 * Some CDN edges (e.g. DigitalOcean) cache responses by URL only and ignore
 * `Vary` headers, so `Vary: x-tenant-id` alone does not partition the CDN
 * cache per tenant. Clients can mirror the tenant in this query param so it
 * becomes part of the CDN cache key. When present, it must exactly match the
 * `x-tenant-id` header, or the request is rejected with 400 Bad Request.
 */
export const ApiTenantIdQuery = () =>
  ApiQuery({
    name: 'tenant_id',
    required: false,
    description:
      'Optional mirror of the x-tenant-id header, used as a CDN cache-key workaround for edges that ignore Vary headers. If provided, must exactly match x-tenant-id or the request is rejected with 400.',
    schema: { type: 'string' },
  });
