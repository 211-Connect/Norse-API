import { hashCacheKey } from 'src/common/lib/hash-cache-key';

/**
 * One key per word (ISS-2739 follow-up), so queries that share words share
 * cache entries. The value for a word depends on the tenant's documents and
 * on the language (which picks the index), so both are in the key. The
 * entry now carries the document count (ISS-2793), so the prefix moved from
 * rarity3 to rarity4: old entries are never read.
 */
export const wordRarityCacheKey = (
  tenantId: string,
  lang: string,
  word: string,
): string => `search:rarity4:${tenantId}:${lang}:${hashCacheKey(word)}`;
