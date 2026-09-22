/**
 * Relevance cutoff (ISS-1752).
 *
 * Trims low-relevance results from a ranked list so a stakeholder sees a set
 * small enough to review. It does NOT reorder: the best result can still sit
 * at position 900, and if it does, a cutoff hides it rather than surfacing it.
 * Read that trade as agreed-and-known, not as relevance being solved.
 *
 * ONE STRATEGY, NOT TWO
 * ---------------------
 * This shipped with a choice of `score_gap` (first significant cliff in the
 * score sequence) and `relative_to_max` (keep everything within a fraction of
 * the top score), so the two could be compared on identical queries. They were,
 * and the comparison is not close:
 *
 *   across 42 real score sequences, 2 tenants x 21 queries, 300 deep
 *     score_gap         cut inside the unscoped top 20 on 30 of 37 cuts
 *     relative_to_max   on 4 of 30
 *
 *   live, recall of the unscoped top-20 within the kept set
 *     score_gap         7 of 10 query/tenant pairs discarded 15 of the top 20
 *     relative_to_max   19 of 20 pairs returned it complete
 *
 * score_gap also cuts noise: `purple monkey dishwasher` came back as 14
 * confident results, because a flat distribution still contains
 * discontinuities and they are not relevance boundaries.
 *
 * So the parameter is now `off` | `on`, and `on` is the measured strategy.
 * Keeping the loser selectable meant publishing an option we had measured as
 * worse, which no consumer reading the OpenAPI document could have known.
 *
 * Re-introducing a choice later is additive — a new value alongside `on` —
 * whereas supporting a strategy we know over-cuts is a commitment.
 */

export const RELEVANCE_CUTOFF_VALUES = ['off', 'on'] as const;

export type RelevanceCutoffValue = (typeof RELEVANCE_CUTOFF_VALUES)[number];

/**
 * Why a cutoff did not reduce the set. Reported on the wire so a consumer can
 * tell "nothing was cut because nothing needed cutting" apart from "a cut
 * exists but we would not enumerate it" — silence and green are different
 * answers.
 */
export type RelevanceCutoffSkipReason =
  /** Nothing scored meaningfully below the threshold: the distribution is flat. */
  | 'no_elbow'
  /** Fewer matches than the floor, so there is nothing to trim. */
  | 'below_min_keep'
  /**
   * The cut point was located exactly, but keeps more results than we will put
   * into an `ids` filter. Distinct from "no cut was found".
   */
  | 'cut_too_large';
