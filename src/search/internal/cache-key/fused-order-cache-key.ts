import { hashCacheKey } from 'src/common/lib/hash-cache-key';
import { SearchIdentity, searchFingerprint } from '../search-fingerprint';

/**
 * The fused id order of one v2 search (ISS-2499, fusion only), so pages 2..n
 * read the order instead of re-running the ranked lists. Keyed like
 * `relevanceCutoffCacheKey`: the search identity (page and limit excluded),
 * plus what moves the fused order but is not in the identity:
 * - `sort`: relevance and distance fuse a different proximity list.
 * - `cutoff`: with the cut on the lists see only the kept services.
 * - `needs`: the active needs build the need list.
 * - `pinnedMode`: kept for the same reason as the cutoff key (a tenant config
 *   change must not serve an order made under the old mode).
 * The embedding and the predicted codes are derived from the query, as for the
 * cutoff key, so the TTL is minutes.
 */
export const fusedOrderCacheKey = (
  args: SearchIdentity & {
    pinnedMode: string;
    sort: string;
    cutoff: boolean;
    needs?: { code: string; tier: string; score: number }[];
  },
): string => {
  const needs = [...(args.needs ?? [])]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map(({ code, tier, score }) => ({ code, tier, score }));
  const fingerprint = hashCacheKey({
    search: searchFingerprint(args),
    pinnedMode: args.pinnedMode,
    sort: args.sort,
    cutoff: args.cutoff,
    needs,
  });
  return `search:fused:${args.tenantId}:${args.lang}:${fingerprint}:v2`;
};
