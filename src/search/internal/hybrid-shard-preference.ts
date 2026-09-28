import {
  HybridSearchIdentity,
  hybridSearchFingerprint,
} from './hybrid-search-fingerprint';

/**
 * Pinned per search, never per page: each index's primary and replica score
 * differently — BM25 counts each copy's own deleted docs, and the taxonomy kNN
 * walks each copy's own HNSW graph — so a request that lands on either copy
 * returns one of up to four orderings.
 */
export const hybridShardPreference = (search: HybridSearchIdentity): string =>
  `hybrid-${hybridSearchFingerprint(search)}`;
