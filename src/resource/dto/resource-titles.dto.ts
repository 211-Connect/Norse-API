import { z } from 'zod';

export const resourceTitlesSchema = z.object({
  ids: z.array(z.string()).min(1).max(100),
});

export type ResourceTitlesDto = z.infer<typeof resourceTitlesSchema>;
