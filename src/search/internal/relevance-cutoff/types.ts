/**
 * Relevance cutoff (ISS-1752).
 *
 * Trims low-relevance results from a ranked list so a stakeholder sees a set
 * small enough to review. It does NOT reorder: the best result can still sit
 * at position 900, and if it does, a cutoff hides it rather than surfacing it.
 * Read that trade as agreed-and-known, not as relevance being solved.
 */

export const RELEVANCE_CUTOFF_STRATEGIES = [
  'off',
  'score_gap',
  'relative_to_max',
] as const;

export type RelevanceCutoffStrategy =
  (typeof RELEVANCE_CUTOFF_STRATEGIES)[number];

/**
 * Why a cutoff did not reduce the set. Reported on the wire so a consumer can
 * tell "nothing was cut because nothing needed cutting" apart from "the
 * detector could not see far enough to decide" — silence and green are
 * different answers.
 */
export type RelevanceCutoffSkipReason =
  /** No gap cleared the significance guards: the scores are uniform. */
  | 'no_elbow'
  /** Fewer candidates than `minKeep`, so there is nothing to trim. */
  | 'below_min_keep'
  /** The elbow, if any, lies beyond the probed candidate ceiling. */
  | 'candidate_ceiling'
  /**
   * A cut exists and was located exactly, but keeps more results than we are
   * willing to enumerate into an `ids` filter. Distinct from
   * `candidate_ceiling`: there the cut point was never found, here it was
   * found and is simply too large to be worth making.
   */
  | 'cut_too_large';

export interface RelevanceCutoffDecision {
  /** Number of leading results to keep, or null when declining to cut. */
  keep: number | null;
  /** Populated exactly when `keep` is null. */
  reason: RelevanceCutoffSkipReason | null;
  /**
   * Score of the last kept result, **on the probe's scale**. The probe omits
   * the distance decay and the priority boost that the main query adds, so this
   * is not comparable to a `_score` in the response — only to another
   * `cutoffScore` from the same strategy. Reported for observability so a
   * shipped threshold can be evaluated retroactively against real traffic
   * (ISS-1378) rather than requiring the queries to be re-run.
   */
  cutoffScore: number | null;
}

export interface ScoreGapOptions {
  /** Never cut below this many results. */
  minKeep: number;
  /** The winning gap must exceed this multiple of the median adjacent gap. */
  significance: number;
  /** ...and must also drop at least this fraction of the preceding score. */
  minRelativeDrop: number;
}

export interface RelativeToMaxOptions {
  /** Keep results scoring at least this fraction of the top score. */
  fraction: number;
  /** Never cut below this many results. */
  minKeep: number;
}
