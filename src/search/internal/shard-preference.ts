import { SearchIdentity, searchFingerprint } from './search-fingerprint';

/**
 * Pinned per search, never per page: each index's primary and replica score
 * differently — BM25 counts each copy's own deleted docs, and the taxonomy kNN
 * walks each copy's own HNSW graph — so a request that lands on either copy
 * returns one of the copies' orderings, and paging across copies skips and
 * repeats records.
 *
 * `scope` names the search path (`hybrid`, or the text path's query type). It
 * must not start with `_`, which is Elasticsearch's reserved preference syntax.
 */
export const shardPreference = (
  scope: string,
  search: SearchIdentity,
): string => `${scope}-${searchFingerprint(search)}`;
