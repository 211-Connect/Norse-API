import { z } from 'zod';

export const xTenantIdSchema = z.string(); //.uuid(); We still have tenants not using UUID for tenant_id.
export const acceptLanguageSchema = z.string().transform((val) => {
  // Split the header into individual language tags
  const tags = val.split(',').map((tag) => tag.trim());

  // Parse each tag
  const parsedTags = tags.map((tag) => {
    const [full, qPart] = tag.split(';');
    const base = full.slice(0, 2).toLowerCase();
    const q = qPart ? parseFloat(qPart.split('=')[1]) : 1;
    return { full, base, q };
  });

  // Sort by q value (descending) and return the highest priority base language code
  return parsedTags.sort((a, b) => b.q - a.q)[0].base;
});

export const headersSchema = z.object({
  'x-tenant-id': xTenantIdSchema,
  'accept-language': acceptLanguageSchema,
});

export type XTenantIdDto = z.infer<typeof xTenantIdSchema>;
export type AcceptLanguageDto = z.infer<typeof acceptLanguageSchema>;
export type HeadersDto = z.infer<typeof headersSchema>;
