import type { AggregationsStringTermsAggregate } from '@elastic/elasticsearch/lib/api/types';
import type { Aggregations } from '../../types';

/**
 * The `_source` paths that the terms aggregations in `aggs` read: each
 * `field` without its `.keyword` suffix.
 */
export const facetSourceFields = (aggs: Aggregations): string[] => [
  ...new Set(
    Object.values(aggs).flatMap((agg) => {
      const field = (agg as { terms?: { field?: string } }).terms?.field;
      return field ? [field.replace(/\.keyword$/, '')] : [];
    }),
  ),
];

/** Every leaf value at a dotted path; arrays on the way are flattened. */
const valuesAt = (source: unknown, path: string[]): unknown[] => {
  if (source === null || source === undefined) return [];
  if (Array.isArray(source)) return source.flatMap((s) => valuesAt(s, path));
  if (path.length === 0) return [source];
  if (typeof source !== 'object') return [];
  const [head, ...rest] = path;
  const record = source as Record<string, unknown>;
  // A source may hold a dotted key ("a.b") instead of nested objects.
  for (let i = path.length; i > 1; i--) {
    const joined = path.slice(0, i).join('.');
    if (joined in record) return valuesAt(record[joined], path.slice(i));
  }
  return valuesAt(record[head], rest);
};

/**
 * Computes the terms aggregations of `aggs` over a small set of documents in
 * Node (ISS-2499 fusion only: the fused set is at most 100 services). Each
 * document counts once per distinct value. Buckets follow the Elasticsearch
 * terms order: count descending, then key ascending, cut to `size`.
 */
export const facetCountsFromDocs = (
  aggs: Aggregations,
  sources: unknown[],
): Record<string, AggregationsStringTermsAggregate> => {
  const out: Record<string, AggregationsStringTermsAggregate> = {};
  for (const [name, agg] of Object.entries(aggs)) {
    const terms = (agg as { terms?: { field?: string; size?: number } }).terms;
    if (!terms?.field) continue;
    const path = terms.field.replace(/\.keyword$/, '').split('.');
    const counts = new Map<string, number>();
    for (const source of sources) {
      const keys = new Set(
        valuesAt(source, path)
          .filter(
            (v) =>
              typeof v === 'string' ||
              typeof v === 'number' ||
              typeof v === 'boolean',
          )
          .map(String),
      );
      for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
    );
    const size = terms.size ?? 10;
    const kept = sorted.slice(0, size);
    out[name] = {
      doc_count_error_upper_bound: 0,
      sum_other_doc_count: sorted
        .slice(size)
        .reduce((sum, [, count]) => sum + count, 0),
      buckets: kept.map(([key, doc_count]) => ({ key, doc_count })),
    };
  }
  return out;
};
