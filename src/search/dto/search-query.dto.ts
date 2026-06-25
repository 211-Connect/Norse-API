import { z } from 'zod';

// Recursive schema definition for nested AND/OR
const createComplexQuerySchema = (depth: number): z.ZodTypeAny => {
  if (depth <= 0) {
    return z.string(); // Base case: At depth 0, allow a simple string
  }

  return z
    .object({
      OR: z.array(createComplexQuerySchema(depth - 1)).optional(),
      AND: z.array(createComplexQuerySchema(depth - 1)).optional(),
    })
    .refine((data) => data.OR !== undefined || data.AND !== undefined, {
      message: "Object must have 'OR' or 'AND' property",
    });
};

export const searchQuerySchema = z.object({
  query: z
    .string()
    .or(z.array(z.string()))
    .or(createComplexQuerySchema(5))
    .default(''),
  query_type: z
    .enum(['text', 'taxonomy', 'organization', 'more_like_this', 'hybrid'])
    .default('text'),
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
  filters: z.record(z.string(), z.string().or(z.array(z.string()))).default({}),
  // Hard taxonomy scope (HSIS codes) from the AI predict/re-rank flow.
  // Accepts a comma-delimited string (e.g. "BM-1400,BM-1700") or an array and
  // normalizes to a deduplicated string[]. Applied as a nested terms filter on
  // taxonomies.code in hybrid search.
  // Tolerant of URL-encoded payloads where each code is wrapped in quotes
  // (e.g. `"B","BT-8610.2500"`) and an optional surrounding [ ] array wrapper;
  // surrounding quotes/brackets/whitespace are stripped while dots in codes
  // (e.g. BD-1800.8200-150) are preserved.
  taxonomy: z
    .string()
    .or(z.array(z.string()))
    .transform((val) => {
      const raw = Array.isArray(val)
        ? val
        : val
            .replace(/^\s*\[/, '')
            .replace(/\]\s*$/, '')
            .split(',');
      return Array.from(
        new Set(
          raw
            .map((code) =>
              code
                .trim()
                .replace(/^["']+|["']+$/g, '')
                .trim(),
            )
            .filter(Boolean),
        ),
      );
    })
    .default([]),
  distance: z.coerce.number().int().nonnegative().default(0),
  age: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().positive().max(300).min(25).default(25),
  geo_type: z.enum(['boundary', 'proximity']).optional(),
  sort: z
    .enum(['relevance', 'distance', 'name', 'organization'])
    .optional()
    .default('relevance'),
});

export type SearchQueryDto = z.infer<typeof searchQuerySchema>;
