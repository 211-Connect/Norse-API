import { z } from 'zod';

export const taxonomyTermsQuerySchema = z.object({
  terms: z
    .union([z.array(z.string()), z.string()])
    .transform((val) => (typeof val === 'string' ? [val] : val))
    .default([]),
});

export type TaxonomyTermsQueryDto = z.infer<typeof taxonomyTermsQuerySchema>;
