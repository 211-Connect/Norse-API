export const normalizeTaxonomies = (taxonomies: string[]): string[] =>
  Array.from(new Set(taxonomies.filter(Boolean))).sort();
