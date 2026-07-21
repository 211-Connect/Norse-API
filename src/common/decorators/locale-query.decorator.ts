import { ApiQuery } from '@nestjs/swagger';

/**
 * Documents the optional `locale` query parameter enforced by TenantMiddleware.
 *
 * Same CDN cache-key rationale as `ApiTenantIdQuery`, but for the resolved
 * `accept-language` locale. When present, it must exactly match the value
 * resolved from the `accept-language` header, or the request is rejected
 * with 400 Bad Request.
 */
export const ApiLocaleQuery = () =>
  ApiQuery({
    name: 'locale',
    required: false,
    description:
      'Optional mirror of the resolved accept-language locale, used as a CDN cache-key workaround for edges that ignore Vary headers. If provided, must exactly match the resolved accept-language value or the request is rejected with 400.',
    schema: { type: 'string' },
  });
