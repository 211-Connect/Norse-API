import { z } from 'zod';

export const xTenantIdSchema = z.string(); //.uuid(); We still have tenants not using UUID for tenant_id.
export const acceptLanguageSchema = z.string().transform((val) => {
  return val
    .split(',')
    .map((tag) => {
      const [lang, qPart] = tag.trim().split(';');
      const q = qPart ? parseFloat(qPart.split('=')[1]) || 1 : 1;

      let base = lang;

      if (lang.includes('-')) {
        const parts = lang.split('-');

        // Apply sanitization: first part to lowercase, rest preserved
        base = [parts[0].toLowerCase(), ...parts.slice(1)].join('-');
      } else {
        // If it's just a two-character code, make it lowercase
        base = lang.length === 2 ? lang.toLowerCase() : lang;
      }

      return { base, q };
    })
    .sort((a, b) => b.q - a.q)[0].base; // Return highest priority language
});

export const headersSchema = z.object({
  'x-tenant-id': xTenantIdSchema,
  'accept-language': acceptLanguageSchema,
  'x-api-key': z.string().optional(),
});

export type XTenantIdDto = z.infer<typeof xTenantIdSchema>;
export type AcceptLanguageDto = z.infer<typeof acceptLanguageSchema>;
export type HeadersDto = z.infer<typeof headersSchema>;
