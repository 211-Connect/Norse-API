import { hashCacheKey } from './hash-cache-key';
import {
  HybridSearchIdentity,
  hybridSearchFingerprint,
} from '../hybrid-search-fingerprint';

/**
 * Keyed on the search's identity, so pages 2..n of the same search reuse one
 * probe instead of re-running it: the cut is a property of the result set, not
 * the page, and is computed on relevance before the caller's sort orders
 * whatever survived.
 *
 * `pinnedMode` *is* included, because the probe reads it: under `ignore` the
 * pinned boost clause is dropped entirely, which moves every score and can move
 * the elbow. Excluding it meant a tenant config change served a probe computed
 * under the old mode until the entry expired.
 *
 * Two inputs are still absent and cannot be keyed from here: the query
 * embedding and the predicted taxonomy codes. Both are derived from
 * `queryStr` + tenant, so they are stable for a stable model — but they move
 * when the embedding model is swapped or when ml-broker's tenant vocabulary
 * changes (ISS-1755), and a stale probe survives until the TTL. That window is
 * why `CUTOFF_PROBE_TTL_MS` is minutes rather than the cache default's hour.
 */
export const relevanceCutoffCacheKey = (
  args: HybridSearchIdentity & { pinnedMode: string },
): string => {
  const fingerprint = hashCacheKey({
    search: hybridSearchFingerprint(args),
    pinnedMode: args.pinnedMode,
  });

  return `search:cutoff:${args.tenantId}:${args.lang}:${fingerprint}`;
};
