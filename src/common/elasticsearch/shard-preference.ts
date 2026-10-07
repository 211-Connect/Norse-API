import { Sort } from '@elastic/elasticsearch/lib/api/types';

/**
 * Pins every Elasticsearch call of one search to one set of shard copies.
 *
 * Each index's primary and replica score differently — BM25 counts each copy's
 * own deleted docs, and a kNN walks each copy's own HNSW graph — so identical
 * requests that land on different copies return different orderings, and
 * paging across copies skips and repeats records. A preference routes every
 * request with the same value to the same copies.
 *
 * `fingerprint` must identify the search, never the page: leave out `page`,
 * `limit`, `sort` and cursors, so every page of a search reads the same copies.
 * `scope` names the search path. Neither may start with `_`, which is
 * Elasticsearch's reserved preference syntax.
 *
 * Changing either input for an existing path moves its searches to the other
 * copy once — a visible reorder for API consumers. Pin the output in a test.
 */
export const shardPreference = (scope: string, fingerprint: string): string =>
  `${scope}-${fingerprint}`;

/**
 * Relevance, then a unique field. Without the unique final key, `_score` ties
 * fall to Lucene doc order, which differs between copies and across merges.
 * Sorting by `_score` still needs a {@link shardPreference}: the scores
 * themselves differ between copies.
 */
export const scoreThenUnique = (uniqueField: string): Sort => [
  { _score: { order: 'desc' } },
  { [uniqueField]: { order: 'asc' } },
];
