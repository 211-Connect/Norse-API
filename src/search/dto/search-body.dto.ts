import { z } from 'zod';

export const searchBodySchema = z.object({
  geometry: z.any().optional(),
});

export type SearchBodyDto = z.infer<typeof searchBodySchema>;
