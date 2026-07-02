import { hashCacheKey } from './hash-cache-key';
import { normalizeTaxonomies } from './normalize-taxonomies';

export const hybridDocumentsCountCacheKey = (
  tenantId: string,
  lang: string,
  taxonomies: string[],
): string => {
  const normalizedTaxonomies = normalizeTaxonomies(taxonomies);

  return `search:count:${tenantId}:${lang}:${hashCacheKey(normalizedTaxonomies)}`;
};
