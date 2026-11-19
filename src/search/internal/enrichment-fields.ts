/**
 * SUNE need enrichment written by Dagster onto hybrid_search_resources_*
 * documents. The enrichment is proprietary and this API is open source:
 * search may query or boost on these fields, but responses must never
 * include them (David, 2026-11-12, ISS-2754).
 */
export const SUNE_ENRICHMENT_FIELDS = [
  'sune_needs',
  'sune_need_weights',
  'sune_scorecard_version',
] as const;

/** Returns a shallow copy of `source` without the SUNE enrichment fields. */
export function stripEnrichment<T extends object | undefined>(source: T): T {
  if (source === undefined || source === null) return source;
  const copy = { ...source } as Record<string, unknown>;
  for (const field of SUNE_ENRICHMENT_FIELDS) delete copy[field];
  return copy as T;
}
