export const SEARCH_QUERY_TYPES = [
  'text',
  'taxonomy',
  'more_like_this',
  'hybrid',
] as const;

export type SearchQueryType = (typeof SEARCH_QUERY_TYPES)[number];
