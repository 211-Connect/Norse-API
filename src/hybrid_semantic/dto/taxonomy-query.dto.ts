/**
 * DTOs for advanced taxonomy queries with AND/OR logic
 */

export class TaxonomyQueryInput {
  AND?: string[];
  OR?: string[];
}

export class TaxonomyQuery {
  query?: TaxonomyQueryInput;
}
