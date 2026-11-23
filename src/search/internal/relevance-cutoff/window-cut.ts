/**
 * Windowed relevance cut (build W, 2026-11-23). Pure client-side rule applied
 * to the scores of one windowed `_search`; no Elasticsearch call.
 *
 * Kept count = min(rank cap, today's rule), where today's rule keeps every
 * hit scoring at least min(0.2 x top, score of rank 20). The rank-20 clamp is
 * the same one the probe uses, so the window's top 20 always survive. Ties at
 * the threshold stay together, as with the probe's inclusive `min_score`.
 */

/** Hits the windowed search asks for (BM25 size and kNN k). */
export const CUTOFF_WINDOW_SIZE = 200;
/** kNN candidates per shard group. */
export const CUTOFF_WINDOW_NUM_CANDIDATES = 400;
/** At most this many hits are kept, whatever the rule says. */
export const CUTOFF_WINDOW_RANK_CAP = 100;

const FRACTION_OF_TOP = 0.2;
/** Zero-based rank whose score clamps the threshold (the 21st hit). */
const FLOOR_RANK = 20;

export interface WindowCut {
  /** Number of leading hits to keep. */
  kept: number;
  /** Score of the last kept hit; null with no hits. */
  cutoffScore: number | null;
  /** True when the rank cap, not the score rule, decided the count. */
  capped: boolean;
}

/** `scores` must be in descending order (the order Elasticsearch returns). */
export const cutWindow = (scores: number[]): WindowCut => {
  if (scores.length === 0) return { kept: 0, cutoffScore: null, capped: false };
  const top = scores[0];
  // A flat or non-positive top has no scale to take a fraction of: the rule
  // keeps everything, the cap still applies.
  const threshold =
    top > 0
      ? Math.min(FRACTION_OF_TOP * top, scores[FLOOR_RANK] ?? Infinity)
      : -Infinity;
  let byRule = 0;
  while (byRule < scores.length && scores[byRule] >= threshold) byRule++;
  const capped = byRule > CUTOFF_WINDOW_RANK_CAP;
  const kept = Math.min(byRule, CUTOFF_WINDOW_RANK_CAP);
  return { kept, cutoffScore: scores[kept - 1] ?? null, capped };
};
