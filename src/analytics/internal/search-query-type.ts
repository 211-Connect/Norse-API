import type { SearchQueryType } from '../types';

export const SEARCH_QUERY_TYPES: readonly SearchQueryType[] = [
  'text',
  'taxonomy',
  'hybrid',
] as const;

export function isSearchQueryType(
  value: string | null,
): value is SearchQueryType {
  return (
    value !== null && (SEARCH_QUERY_TYPES as readonly string[]).includes(value)
  );
}
