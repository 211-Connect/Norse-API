import {
  RelativeToMaxOptions,
  RelevanceCutoffDecision,
  ScoreGapOptions,
} from './types';

/**
 * Never cut a result set down below this, whatever the distribution says.
 *
 * Observed against Santa Cruz County (tenant 303ba4e4…) on 2026-09-18: real
 * elbows in this data sit at 3–11 results, so a floor of 10 sat on top of the
 * signal rather than under it.
 */
export const DEFAULT_MIN_KEEP = 5;
/** The winning gap must exceed this multiple of the median adjacent gap. */
export const DEFAULT_SIGNIFICANCE = 3;
/** ...and must also drop at least this fraction of the preceding score. */
export const DEFAULT_MIN_RELATIVE_DROP = 0.15;
/** Keep results scoring at least this fraction of the top score. */
export const DEFAULT_RELATIVE_FRACTION = 0.5;

export const DEFAULT_SCORE_GAP_OPTIONS: ScoreGapOptions = {
  minKeep: DEFAULT_MIN_KEEP,
  significance: DEFAULT_SIGNIFICANCE,
  minRelativeDrop: DEFAULT_MIN_RELATIVE_DROP,
};

export const DEFAULT_RELATIVE_TO_MAX_OPTIONS: RelativeToMaxOptions = {
  fraction: DEFAULT_RELATIVE_FRACTION,
  minKeep: DEFAULT_MIN_KEEP,
};

const declineToCut = (
  reason: RelevanceCutoffDecision['reason'],
): RelevanceCutoffDecision => ({ keep: null, reason, cutoffScore: null });

const median = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

/**
 * Locates the first significant discontinuity ("elbow") in a descending score list and
 * returns how many leading results to keep.
 *
 * The property that matters, and the reason this was chosen over
 * `relative_to_max`: **it can decline to cut.** When every result is uniformly
 * mediocre there is no elbow, and returning everything is the honest answer.
 * That is what the `significance` guard buys — on a flat distribution the
 * largest gap is close to the median gap, the ratio sits near 1, and this
 * returns null. A fraction-of-max rule has no way to express "nothing here is
 * good enough", because by construction its top result is always 1.0.
 *
 * `scores` must be ordered by relevance, descending, and must NOT be the
 * presentation order of the response: under `sort=distance|name|organization`
 * (or `pinned_resources_mode: 'top'`) the returned hits are not score-ordered,
 * and walking those adjacent pairs measures nothing.
 */
export function detectScoreGapCutoff(
  scores: number[],
  options: ScoreGapOptions,
): RelevanceCutoffDecision {
  const { minKeep, significance, minRelativeDrop } = options;

  if (scores.length <= minKeep) {
    return declineToCut('below_min_keep');
  }

  if (!scores.every((score) => Number.isFinite(score))) {
    return declineToCut('no_elbow');
  }

  const gaps = scores
    .slice(0, -1)
    .map((score, index) => score - scores[index + 1]);

  const positiveGaps = gaps.filter((gap) => gap > 0);
  const baseline = median(positiveGaps);

  // Every score identical (or non-descending input): no discontinuity exists.
  if (baseline <= 0) {
    return declineToCut('no_elbow');
  }

  // A split that keeps K results sits between scores[K-1] and scores[K], i.e.
  // at gaps[K-1]. K runs from 1 up to scores.length - 1; K === length would be
  // "keep everything", which is what declining already expresses.
  //
  // We take the FIRST split that clears both guards, not the largest gap in the
  // window. Largest-gap is the obvious reading of "biggest discontinuity" and
  // it is not usable here: measured against Santa Cruz County on 2026-09-18,
  // one "food" query's cut moved 10 → 19 → 6 → 40 as the search radius went
  // 6 → 7 → 8 → 9 miles. Whichever single gap happens to be widest wins, so
  // admitting a handful of documents into the leading gap collapses it and the
  // argmax jumps to an unrelated split far down the tail. The first qualifying
  // cliff is stable under exactly that perturbation, because filling in below
  // it does not move it.
  //
  // The search also starts at 1, NOT at minKeep, and clamps afterwards. Those
  // differ: starting at the floor makes the detector skip a real cliff above it
  // and settle on a weaker one below, silently and with full confidence.
  let bestKeep = -1;
  let bestGap = 0;

  for (let keep = 1; keep < scores.length; keep += 1) {
    const gap = gaps[keep - 1];
    const precedingScore = scores[keep - 1];

    if (gap < significance * baseline) continue;
    if (precedingScore <= 0 || gap / precedingScore < minRelativeDrop) continue;

    bestGap = gap;
    bestKeep = keep;
    break;
  }

  if (bestKeep < 0 || bestGap <= 0) {
    return declineToCut('no_elbow');
  }

  let keep = Math.max(bestKeep, minKeep);

  // Never split a group of equally-scored results. The floor (and, for
  // relative_to_max, the fraction) can land mid-tie, which drops one document
  // and keeps another the engine considers exactly as relevant — indefensible
  // to a caller looking at the two side by side. Observed on a `free dental
  // care` rerank where four programmes scored 0.6335 and the cut kept two of
  // them. Extending forward rather than back keeps the benefit of the doubt.
  while (keep < scores.length && scores[keep] === scores[keep - 1]) {
    keep += 1;
  }

  if (keep >= scores.length) {
    return declineToCut('no_elbow');
  }

  return { keep, reason: null, cutoffScore: scores[keep - 1] };
}

/**
 * Keeps results scoring at least `fraction` of the top score.
 *
 * Shipped alongside score-gap so the two can be compared on identical queries,
 * as agreed at standup 2026-09-17. Note what it cannot do: a query where every
 * result is poor still yields a 1.0 at the top, so this always cuts at the same
 * fraction whatever the distribution's shape. It is a comparability tool, not a
 * quality signal (ISS-1375).
 *
 * The caller must supply a genuine result-set maximum. `hits.max_score` on the
 * response is the *page* maximum (ISS-1751) and is the wrong denominator here.
 */
export function detectRelativeToMaxCutoff(
  scores: number[],
  options: RelativeToMaxOptions,
): RelevanceCutoffDecision {
  const { fraction, minKeep } = options;

  if (scores.length <= minKeep) {
    return declineToCut('below_min_keep');
  }

  if (!scores.every((score) => Number.isFinite(score))) {
    return declineToCut('no_elbow');
  }

  const topScore = scores[0];
  if (topScore <= 0) {
    return declineToCut('no_elbow');
  }

  const threshold = fraction * topScore;
  let keep = 0;
  while (keep < scores.length && scores[keep] >= threshold) {
    keep += 1;
  }

  if (keep >= scores.length) {
    return declineToCut('no_elbow');
  }

  const effectiveKeep = Math.max(keep, minKeep);
  if (effectiveKeep >= scores.length) {
    return declineToCut('no_elbow');
  }

  return {
    keep: effectiveKeep,
    reason: null,
    cutoffScore: scores[effectiveKeep - 1],
  };
}
