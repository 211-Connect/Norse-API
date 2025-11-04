import { z } from 'zod';

/**
 * Query parameters for taxonomy suggestion endpoint
 */
export const taxonomySuggestionQuerySchema = z.object({
  // The user's search query (will be embedded for semantic search)
  query: z.string().min(1, 'Query must not be empty'),

  // Optional: specific taxonomy code prefix(es) to filter by
  // Accepts single string or array of strings, always transformed to array
  code: z
    .union([z.string(), z.array(z.string().min(1))])
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      return typeof val === 'string' ? [val] : val;
    }),

  // Number of suggestions to return (default: 10, max: 50)
  limit: z.coerce.number().int().positive().max(50).default(10),

  // Language/locale for the search
  lang: z.string().default('en'),
});

export type TaxonomySuggestionQueryDto = z.infer<
  typeof taxonomySuggestionQuerySchema
>;
