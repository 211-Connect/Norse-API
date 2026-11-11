import { hashCacheKey } from 'src/common/lib/hash-cache-key';

export const wordRarityCacheKey = (
  tenantId: string,
  lang: string,
  words: string[],
): string => `search:rarity:${tenantId}:${lang}:${hashCacheKey(words)}`;
