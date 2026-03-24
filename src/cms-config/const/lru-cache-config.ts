import { ONE_MINUTE } from 'src/common/const';

export const LRU_CACHE_CONFIG = {
  max: 1000,
  ttl: ONE_MINUTE * 1000, // it's not possible to invalidate memory cache for all instances so use shorter TTL to limit stale data
  noUpdateTTL: true, // only reset TTL on set, not on get/has, to avoid keeping stale data indefinitely in a long-running instance
};
