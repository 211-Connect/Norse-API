import { z } from 'zod';

export const searchQuerySchema = z.object({
  query: z.string().or(z.array(z.string())).default(''),
  query_type: z.string().default('text'),
  page: z.coerce.number().int().positive().default(1),
  coords: z
    .string()
    .transform((val) => {
      const parts = val.split(',');
      if (parts.length !== 2) {
        return undefined;
      }

      const numbers = parts.map(parseFloat);
      if (numbers.some(isNaN)) {
        return undefined;
      }

      return numbers;
    })
    .optional(),
  filters: z.record(z.string().or(z.array(z.string()))).default({}),
  distance: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(300).min(25).default(25),
});

export type SearchQueryDto = z.infer<typeof searchQuerySchema>;
