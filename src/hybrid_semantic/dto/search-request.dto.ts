import { z } from 'zod';

/**
 * Custom weights schema for fine-tuning search scoring
 */
export const customWeightsSchema = z
  .object({
    // Semantic search strategy weights
    semantic: z
      .object({
        service: z.number().min(0).max(10).optional().default(1.0),
        taxonomy: z.number().min(0).max(10).optional().default(1.0),
        organization: z.number().min(0).max(10).optional().default(1.0),
      })
      .optional(),

    // Overall strategy weights
    strategies: z
      .object({
        semantic_search: z.number().min(0).max(10).optional().default(1.0),
        keyword_search: z.number().min(0).max(10).optional().default(1.0),
        intent_driven: z.number().min(0).max(10).optional().default(1.0),
      })
      .optional(),

    // Geospatial weighting
    geospatial: z
      .object({
        weight: z.number().min(0).max(10).optional().default(2.0),
        decay_scale: z.number().min(1).max(200).optional().default(50),
        decay_offset: z.number().min(0).max(50).optional().default(0),
      })
      .optional(),
  })
  .optional();

/**
 * Enhanced search request supporting intent-driven search parameters and advanced taxonomy queries.
 */
export const searchRequestSchema = z
  .object({
    // Query can be optional for taxonomy-only searches
    q: z.string().optional(),

    lang: z.string().default('en'),
    limit: z.number().int().min(1).max(100).default(10),
    lat: z.number().optional(),
    lon: z.number().optional(),
    distance: z.number().int().optional(),
    search_after: z.array(z.any()).optional(),

    // ADVANCED TAXONOMY QUERY FIELD
    query: z
      .object({
        AND: z.array(z.string()).optional(),
        OR: z.array(z.string()).optional(),
      })
      .optional(),

    // SEARCH ENHANCEMENT FIELDS
    facets: z.record(z.array(z.string())).optional(),
    location_point_only: z.boolean().default(false),

    // KEYWORD SEARCH COMPATIBILITY
    keyword_search_only: z.boolean().default(false),
    search_operator: z.enum(['AND', 'OR']).default('AND'),

    // RESPONSE CUSTOMIZATION
    exclude_service_area: z.boolean().default(false),

    // INTENT-DRIVEN SEARCH PARAMETERS
    intent_override: z.string().optional(),
    disable_intent_classification: z.boolean().default(false),

    // COMPREHENSIVE WEIGHT CUSTOMIZATION
    custom_weights: customWeightsSchema,
  })
  .refine((data) => data.q || data.query, {
    message: "Either 'q' (query) or 'query' (taxonomy) must be provided",
  });

export type SearchRequestDto = z.infer<typeof searchRequestSchema>;

export interface SearchRequestHelpers {
  hasTaxonomyQuery(): boolean;
  isTaxonomyOnlySearch(): boolean;
  isPureTaxonomySearch(): boolean;
  getTaxonomyQueryDescription(): string;
}
