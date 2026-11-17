import { SUNE_ENRICHMENT_FIELDS } from './enrichment-fields';

/**
 * Taxonomy text that search results don't need: cards show only a
 * taxonomy's code and name. Descriptions and curated references are long
 * and repeated on every hit, so leaving them out shrinks a /search
 * response a lot. The resource endpoint still returns them.
 */
export const SEARCH_EXCLUDED_TAXONOMY_FIELDS = [
  'taxonomies.description',
  'taxonomies.use_references',
  'taxonomies.see_also_references',
] as const;

/** `_source` excludes of a /search list request (v1 and hybrid). */
export const SEARCH_SOURCE_EXCLUDES: string[] = [
  'embedding',
  'service_area',
  ...SEARCH_EXCLUDED_TAXONOMY_FIELDS,
  ...SUNE_ENRICHMENT_FIELDS,
];
