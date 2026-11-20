/**
 * v2 pinned gate (Lucas 2026-11-18). A pinned service leads only when it
 * matches the query well: its relevance reaches a fraction of the best
 * non-pinned relevance. Otherwise it gets no pinned bonus at all.
 */

import type { PinnedResourcesMode } from '../../../cms-config/types';

/** Fraction of the best non-pinned relevance score a pinned service must reach to lead (v2). Lucas 2026-11-18: 0.85 (wa211, 38 queries: 6 queries lift, 7 services). */
export const PINNED_GATE_FRACTION = 0.85;
/** Max pinned hits the gate request reads (top_hits size limit is 100). */
export const PINNED_GATE_MAX_HITS = 100;
/** Constant added to gated pinned services on the summed path so they lead; real hybrid scores stay far below it. */
export const PINNED_GATE_TIER_BOOST = 10_000;

export type PinnedGateHit = { id: string; score: number };

/**
 * Ids of the pinned hits whose score reaches `fraction` x `topOtherScore`,
 * best first (score descending, then id ascending). Empty when the best
 * non-pinned score is not a positive number.
 */
export function selectGatedPinnedIds(
  pinned: PinnedGateHit[],
  topOtherScore: number,
  fraction = PINNED_GATE_FRACTION,
): string[] {
  if (!Number.isFinite(topOtherScore) || topOtherScore <= 0) return [];
  const threshold = fraction * topOtherScore;
  const kept = pinned
    .filter(
      (hit) =>
        Number.isFinite(hit.score) && hit.score > 0 && hit.score >= threshold,
    )
    .sort((a, b) =>
      b.score !== a.score
        ? b.score - a.score
        : a.id < b.id
          ? -1
          : a.id > b.id
            ? 1
            : 0,
    );
  return [...new Set(kept.map((hit) => hit.id))];
}

/**
 * True when the v2 query path drops the pinned bonus and the gate decides
 * the lead: v2, a ranked request and a non-empty query.
 */
export function pinnedGateUsesQuery(args: {
  v2: boolean;
  rank: boolean;
  queryStr: string;
}): boolean {
  return args.v2 && args.rank && args.queryStr.trim().length > 0;
}

/**
 * In v2 the tenant `pinned_resources_mode` has two states only (Lucas
 * 2026-11-18): `care` (boost or top) and `do_not_care` (ignore). The boost/top
 * difference does not change any v2 request.
 */
export type V2PinnedState = 'care' | 'do_not_care';

export function v2PinnedState(mode: PinnedResourcesMode): V2PinnedState {
  return mode === 'ignore' ? 'do_not_care' : 'care';
}

/**
 * The pinned mode a v2 ranked request builds with (Lucas 2026-11-18). Do not
 * care: `ignore`. A non-empty query: `ignore`, because the gate decides the
 * lead. Browse (empty query): `top` for relevance or no sort, so boost and top
 * build the same request; an explicit sort wins and gets `ignore`.
 */
export function v2RankingPinnedMode(args: {
  mode: PinnedResourcesMode;
  queryStr: string;
  sort: string | undefined;
}): PinnedResourcesMode {
  if (v2PinnedState(args.mode) === 'do_not_care') return 'ignore';
  if (args.queryStr.trim().length > 0) return 'ignore';
  return (args.sort ?? 'relevance') === 'relevance' ? 'top' : 'ignore';
}
