import { hashCacheKey } from 'src/common/lib/hash-cache-key';

/**
 * One key per word (ISS-2739 follow-up), so queries that share words share
 * cache entries. The value for a word depends on the tenant's documents and
 * on the language (which picks the index), so both are in the key.
 */
export const wordRarityCacheKey = (
  tenantId: string,
  lang: string,
  word: string,
): string => `search:rarity3:${tenantId}:${lang}:${hashCacheKey(word)}`;
