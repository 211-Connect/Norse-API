import { z } from 'zod';

export const searchQuerySchema = z.object({
  query: z.string().default(''),
  code: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
});

export type SearchQueryDto = z.infer<typeof searchQuerySchema>;
