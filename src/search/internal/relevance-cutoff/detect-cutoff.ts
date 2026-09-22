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
/**
 * Keep results scoring at least this fraction of the top score.
 *
 * 0.2, not 0.5. Measured across 42 real score sequences (2 tenants x 21 queries,
 * 300 deep, probe-shaped): at 0.5 the rule cut inside the unscoped top 20 on 24
 * of 40 queries — the same over-cutting `score_gap` shows. At 0.2 it cuts on 30
 * of 42 with a median keep of 38 and lands inside the top 20 only 4 times.
 *
 * The cost of laxness is queries where nothing is trimmed. That is the intended
 * trade: the complaint this feature answers is "1,200 results is unreviewable",
 * not "give me the best five", and those need very different precision.
 */
export const DEFAULT_RELATIVE_FRACTION = 0.2;

/**
 * How many leading entries it takes to see `minKeep` distinct groups.
 *
 * The index is service-at-location, so one service with N locations is N
 * documents scoring near-identically and ranking adjacently. A floor of 5
 * *documents* was a floor of 2 *services* on `substance abuse treatment`
 * (Santa Cruz, 2026-09-22) — the slots were filled by one provider's branches
 * while four other treatment centres were cut. The floor is meant to guarantee
 * a reviewable number of choices, and a choice is a service.
 *
 * With no groups supplied this is exactly `minKeep`, so callers that do not
 * know about grouping behave as before.
 */
const floorIndex = (
  minKeep: number,
  length: number,
  groups?: readonly string[],
): number => {
  if (!groups || groups.length === 0) {
    return minKeep;
  }

  const seen = new Set<string>();
  for (let i = 0; i < length && i < groups.length; i += 1) {
    seen.add(groups[i]);
    if (seen.size >= minKeep) {
      return i + 1;
    }
  }

  return length;
};

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
  groups?: readonly string[],
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

  let keep = Math.max(bestKeep, floorIndex(minKeep, scores.length, groups));

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
 * as agreed at standup 2026-09-17.
 *
 * An earlier version of this comment claimed the rule "always cuts" and has no
 * way to express "nothing here is good enough", because its top result is 1.0 by
 * construction. That holds at a strict fraction and is false at a lax one. On a
 * flat distribution — a nonsense query scoring on vector noise alone — every
 * result sits above 0.2 x max, `keep` runs past the end of the sequence, and the
 * rule declines. Measured: `asdfqwerzxcv` and `purple monkey dishwasher` both
 * decline at 0.2 and both are cut to 7-14 results by `score_gap`, which was
 * chosen over this rule precisely for the property it turns out not to have.
 *
 * The caller must supply a genuine result-set maximum. `hits.max_score` on the
 * response is the *page* maximum (ISS-1751) and is the wrong denominator here.
 */
export function detectRelativeToMaxCutoff(
  scores: number[],
  options: RelativeToMaxOptions,
  groups?: readonly string[],
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

  let effectiveKeep = Math.max(
    keep,
    floorIndex(minKeep, scores.length, groups),
  );

  // The threshold itself cannot split a tie — equal scores are all above or all
  // below it — but the minKeep clamp can land mid-group, which is the same
  // defect fixed in detectScoreGapCutoff. Keeping two of four identically
  // scored results and dropping two is as indefensible here as it is there,
  // even though this strategy exists for comparison rather than production.
  while (
    effectiveKeep < scores.length &&
    scores[effectiveKeep] === scores[effectiveKeep - 1]
  ) {
    effectiveKeep += 1;
  }

  if (effectiveKeep >= scores.length) {
    return declineToCut('no_elbow');
  }

  return {
    keep: effectiveKeep,
    reason: null,
    cutoffScore: scores[effectiveKeep - 1],
  };
}
