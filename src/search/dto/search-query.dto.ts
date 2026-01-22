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
  geo_type: z.enum(['bbox', 'radius']).optional(),
  bbox: z
    .string()
    .transform((val) => {
      const parts = val.split(',');
      if (parts.length !== 4) return undefined;
      const numbers = parts.map(parseFloat);
      if (numbers.some(isNaN)) return undefined;
      return numbers as [number, number, number, number];
    })
    .optional(),
}).refine(
  (data) => {
    if (data.geo_type === 'bbox') {
      return !!data.bbox;
    }
    if (data.geo_type === 'radius') {
      return !!data.coords && data.distance > 0;
    }
    return true;
  },
  {
    message:
      "Invalid geo parameters: 'bbox' requires 'bbox' param; 'radius' requires 'coords' and 'distance'",
    path: ['geo_type'],
  },
);

export type SearchQueryDto = z.infer<typeof searchQuerySchema>;
