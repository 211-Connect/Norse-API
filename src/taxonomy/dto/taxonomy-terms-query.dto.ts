import { z } from 'zod';

export const taxonomyTermsQuerySchema = z.object({
  terms: z.array(z.string()).default([]),
});

export type TaxonomyTermsQueryDto = z.infer<typeof taxonomyTermsQuerySchema>;
