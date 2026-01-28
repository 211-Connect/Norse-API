// Top-level facets mapping (facet key -> human-readable name)
export type SearchFacets = Record<string, string>;

// Per-document facet values: language -> array of values
// Example: { area_served_by_county: { en: ['Dakota County'], es: ['Condado de Dakota'] } }
export type DocumentFacets = Record<string, Record<string, string[]>>;

// Search response shape returned by SearchController
export type SearchResponse = {
  search: any; // raw Elasticsearch response
  facets: SearchFacets;
  facets_values?: Record<string, Record<string, string[]>>;
};
