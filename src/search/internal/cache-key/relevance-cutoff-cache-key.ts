import { hashCacheKey } from 'src/common/lib/hash-cache-key';
import { SearchIdentity, searchFingerprint } from '../search-fingerprint';

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
  args: SearchIdentity & {
    pinnedMode: string;
    rankingVersion?: 'v1' | 'v2';
    /**
     * Active needs when the probe applies the need boost (v2, option A). Their
     * code, tier and score size the boost, so they move the cut. Absent or
     * empty leaves the key exactly as it was.
     */
    needs?: { code: string; tier: string; score: number }[];
  },
): string => {
  const needs = [...(args.needs ?? [])]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map(({ code, tier, score }) => ({ code, tier, score }));

  const fingerprint = hashCacheKey({
    search: searchFingerprint(args),
    pinnedMode: args.pinnedMode,
    ...(needs.length > 0 ? { needs } : {}),
  });

  // v1 keeps the key string it always had; v2 scores differently, so it must
  // never be served a v1 probe.
  const version = args.rankingVersion === 'v2' ? ':v2' : '';

  return `search:cutoff:${args.tenantId}:${args.lang}:${fingerprint}${version}`;
};
