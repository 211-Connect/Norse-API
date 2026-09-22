import {
  DEFAULT_RELATIVE_TO_MAX_OPTIONS,
  DEFAULT_SCORE_GAP_OPTIONS,
  detectRelativeToMaxCutoff,
  detectScoreGapCutoff,
} from './detect-cutoff';

/**
 * A descending run of `count` scores starting at `from`, stepping down by
 * `step` with a little jitter so no fixture accidentally relies on perfectly
 * uniform arithmetic.
 */
const decay = (from: number, count: number, step: number): number[] =>
  Array.from({ length: count }, (_, i) =>
    Number((from - i * step - (i % 3) * 0.01).toFixed(4)),
  );

describe('detectScoreGapCutoff', () => {
  it('cuts at the cliff when a dense result set has one', () => {
    // 18 strong matches, then a fall off a shelf — the urban shape.
    const scores = [...decay(92, 18, 0.8), ...decay(31, 40, 0.4)];

    const decision = detectScoreGapCutoff(scores, DEFAULT_SCORE_GAP_OPTIONS);

    expect(decision.keep).toBe(18);
    expect(decision.reason).toBeNull();
    expect(decision.cutoffScore).toBe(scores[17]);
  });

  it('declines to cut when every result is uniformly mediocre', () => {
    // The sparse/rural shape: everything is far, gauss is uniformly small, the
    // range compresses and no elbow exists. Returning everything is the honest
    // answer, and this is the property relative_to_max cannot express.
    const scores = decay(42, 120, 0.3);

    const decision = detectScoreGapCutoff(scores, DEFAULT_SCORE_GAP_OPTIONS);

    expect(decision.keep).toBeNull();
    expect(decision.reason).toBe('no_elbow');
    expect(decision.cutoffScore).toBeNull();
  });

  it('declines when the largest gap is typical of the distribution', () => {
    // Every gap is identical, and the winning one clears minRelativeDrop
    // (20/130 = 15.4%) on its own — so only the significance guard can decline
    // here. That isolation is the point: the rural shape above is rejected by
    // both guards and therefore demonstrates neither.
    const scores = [130, 110, 90, 70, 50, 30, 10];

    const decision = detectScoreGapCutoff(scores, DEFAULT_SCORE_GAP_OPTIONS);

    expect(decision.keep).toBeNull();
    expect(decision.reason).toBe('no_elbow');
  });

  it('declines to cut when every score is identical', () => {
    const decision = detectScoreGapCutoff(
      new Array(50).fill(12.5),
      DEFAULT_SCORE_GAP_OPTIONS,
    );

    expect(decision).toEqual({
      keep: null,
      reason: 'no_elbow',
      cutoffScore: null,
    });
  });

  it('declines to cut a set no larger than minKeep', () => {
    const scores = [...decay(90, 2, 1), ...decay(3, 3, 0.1)];
    expect(scores).toHaveLength(DEFAULT_SCORE_GAP_OPTIONS.minKeep);

    const decision = detectScoreGapCutoff(scores, DEFAULT_SCORE_GAP_OPTIONS);

    expect(decision.reason).toBe('below_min_keep');
    expect(decision.keep).toBeNull();
  });

  it('clamps up to minKeep rather than falling through to a weaker cliff', () => {
    // The real elbow is after 3 results. A floor of 10 must not make the
    // detector ignore it and settle on the much weaker 19.3 -> 2 step further
    // down: that is how a cut ends up nowhere near the actual relevance
    // boundary while still reporting applied: true. Keeping 7 extra results is
    // the honest cost of the floor; landing at 11 is a wrong answer.
    const scores = [
      95, 94, 93, 20, 19.9, 19.8, 19.7, 19.6, 19.5, 19.4, 19.3, 2, 1.9, 1.8,
    ];

    const decision = detectScoreGapCutoff(scores, {
      ...DEFAULT_SCORE_GAP_OPTIONS,
      minKeep: 10,
    });

    expect(decision.keep).toBe(10);
    expect(decision.cutoffScore).toBe(19.4);
  });

  it('cuts at the elbow when it sits above the floor', () => {
    const scores = [
      95, 94, 93, 20, 19.9, 19.8, 19.7, 19.6, 19.5, 19.4, 19.3, 2, 1.9, 1.8,
    ];

    // Same data, floor low enough to allow the true elbow.
    expect(
      detectScoreGapCutoff(scores, {
        ...DEFAULT_SCORE_GAP_OPTIONS,
        minKeep: 3,
      }).keep,
    ).toBe(3);
  });

  it('takes the first qualifying cliff, not the largest one', () => {
    // Two cliffs: a 35-point drop at 6, then a bigger 58-point drop at 12.
    // Largest-gap would cut at 12 and is unstable — measured live, admitting a
    // few documents into the leading gap collapses it and sends the argmax to
    // an unrelated split deep in the tail (the same query cut at 10, 19, 6 and
    // 40 as its radius moved 6→9 miles). The first qualifying cliff does not
    // move when the tail below it changes.
    const scores = [
      100, 99, 98, 97, 96, 95, 60, 59, 58, 57, 56, 55, 2, 1.9, 1.8, 1.7,
    ];

    const decision = detectScoreGapCutoff(scores, DEFAULT_SCORE_GAP_OPTIONS);

    expect(decision.keep).toBe(6);
    expect(decision.cutoffScore).toBe(95);
  });

  it('holds the same cut when results are added below the cliff', () => {
    const head = [100, 99, 98, 97, 96, 95, 60, 59, 58, 57, 56, 55];
    const short = [...head, 2, 1.9, 1.8, 1.7];
    const padded = [...head, 40, 39, 38, 30, 29, 28, 2, 1.9, 1.8, 1.7];

    expect(detectScoreGapCutoff(short, DEFAULT_SCORE_GAP_OPTIONS).keep).toBe(
      detectScoreGapCutoff(padded, DEFAULT_SCORE_GAP_OPTIONS).keep,
    );
  });

  it('never splits a group of equally-scored results', () => {
    // The cliff is at 3; the floor pushes the cut to 5, which lands in the
    // middle of four documents the engine scores identically at 0.40. Keeping
    // two of them and dropping two cannot be explained to anyone looking at the
    // results side by side, so the cut extends to the end of the tie.
    const scores = [1.0, 0.9, 0.8, 0.4, 0.4, 0.4, 0.4, 0.3, 0.25, 0.2];

    const decision = detectScoreGapCutoff(scores, DEFAULT_SCORE_GAP_OPTIONS);

    expect(decision.keep).toBe(7);
    expect(scores[decision.keep - 1]).not.toBe(scores[decision.keep]);
  });

  it('prefers the earliest split when two gaps tie', () => {
    const scores = [
      ...decay(90, 12, 0.5),
      // two identical 30-point drops, at keep=12 and keep=24
      ...decay(54, 12, 0.5),
      ...decay(18, 12, 0.5),
    ];

    const gapAtTwelve = scores[11] - scores[12];
    const gapAtTwentyFour = scores[23] - scores[24];
    expect(gapAtTwelve).toBeCloseTo(gapAtTwentyFour, 4);

    expect(detectScoreGapCutoff(scores, DEFAULT_SCORE_GAP_OPTIONS).keep).toBe(
      12,
    );
  });

  it('declines on a large absolute gap that is a small relative drop', () => {
    // A 6-point gap is enormous next to the 0.01 steps around it, but it is
    // only 1.5% of the score it falls from — not a relevance cliff.
    const scores = [...decay(400, 20, 0.01), ...decay(394, 30, 0.01)];

    const decision = detectScoreGapCutoff(scores, DEFAULT_SCORE_GAP_OPTIONS);

    expect(decision.keep).toBeNull();
    expect(decision.reason).toBe('no_elbow');
  });

  it('declines when any score is not finite', () => {
    const scores = [...decay(90, 12, 0.5), Number.NaN, ...decay(10, 12, 0.5)];

    expect(detectScoreGapCutoff(scores, DEFAULT_SCORE_GAP_OPTIONS).keep).toBe(
      null,
    );
  });

  it('declines on an empty list', () => {
    expect(detectScoreGapCutoff([], DEFAULT_SCORE_GAP_OPTIONS)).toEqual({
      keep: null,
      reason: 'below_min_keep',
      cutoffScore: null,
    });
  });

  it('honours a caller-supplied significance threshold', () => {
    const scores = [...decay(6, 15, 0.2), ...decay(2.38, 10, 0.2)];

    // The gap is ~3.8x the median step: significant at 3, not at 8.
    expect(
      detectScoreGapCutoff(scores, {
        ...DEFAULT_SCORE_GAP_OPTIONS,
        significance: 3,
      }).keep,
    ).toBe(15);
    expect(
      detectScoreGapCutoff(scores, {
        ...DEFAULT_SCORE_GAP_OPTIONS,
        significance: 8,
      }).keep,
    ).toBeNull();
  });
});

describe('detectRelativeToMaxCutoff', () => {
  it('never splits a group of equally-scored results either', () => {
    // Reported in review: the minKeep clamp lands mid-tie and keeps three of
    // four results scored 3, dropping the fourth on no distinguishing signal.
    // score_gap already handled this input correctly; this arm did not.
    const scores = [10, 10, 10, 3, 3, 3, 3, 1];

    const decision = detectRelativeToMaxCutoff(scores, {
      fraction: 0.5,
      minKeep: 5,
    });

    expect(decision.keep).toBe(7);
    expect(scores[decision.keep - 1]).not.toBe(scores[decision.keep]);
  });

  it('keeps results at or above the fraction of the top score', () => {
    const scores = [100, 80, 60, 50, 49, 40, 30, 20, 10, 5, 4, 3];

    const decision = detectRelativeToMaxCutoff(scores, {
      fraction: 0.5,
      minKeep: 1,
    });

    // 100, 80, 60, 50 are >= 50; 49 is not.
    expect(decision.keep).toBe(4);
    expect(decision.cutoffScore).toBe(50);
  });

  // Real probe scores for "purple monkey dishwasher" on Santa Cruz, measured
  // 2026-09-22. A query that matches nothing lexically still scores on vector
  // similarity alone, and the result is flat: across all 300 candidates the
  // lowest score is 0.34 of the highest. The synthetic `decay()` fixtures in
  // this file fall away far faster than real noise does, which is why they made
  // relative_to_max look like it always cuts.
  const REAL_NOISE = [
    89.8, 84.4, 80.0, 76.9, 73.8, 72.2, 70.3, 69.9, 68.8, 68.7, 68.6, 67.5,
    67.5, 67.3, 40.9, 40.6, 40.3, 39.6, 39.5, 39.2, 38.6, 38.5, 38.5, 37.7,
    37.7, 37.7, 37.4, 37.4, 37.2, 37.1,
  ];

  it('declines on a real nonsense query, where score_gap cuts', () => {
    // The property this strategy was said not to have. At the shipped fraction
    // nothing falls below 0.2 x max, `keep` runs past the end, and it declines.
    // Raise DEFAULT_RELATIVE_FRACTION back to 0.5 and this goes red: the drop at
    // rank 15 crosses 0.5 x 89.8 and it cuts to 14 unrelated results.
    const lax = detectRelativeToMaxCutoff(
      REAL_NOISE,
      DEFAULT_RELATIVE_TO_MAX_OPTIONS,
    );
    expect(lax.keep).toBeNull();

    // score_gap finds the rank-14 cliff and presents 14 arbitrary services as a
    // curated short list. Noise has discontinuities; they are not relevance.
    expect(
      detectScoreGapCutoff(REAL_NOISE, DEFAULT_SCORE_GAP_OPTIONS).keep,
    ).toBe(14);
  });

  it('declines when nothing falls below the threshold', () => {
    const decision = detectRelativeToMaxCutoff(decay(100, 30, 0.1), {
      fraction: 0.5,
      minKeep: 1,
    });

    expect(decision.keep).toBeNull();
    expect(decision.reason).toBe('no_elbow');
  });

  it('respects minKeep when the fraction would cut deeper', () => {
    const scores = [100, 90, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

    const decision = detectRelativeToMaxCutoff(scores, {
      fraction: 0.5,
      minKeep: 5,
    });

    expect(decision.keep).toBe(5);
    expect(decision.cutoffScore).toBe(8);
  });

  it('declines on a set no larger than minKeep', () => {
    expect(
      detectRelativeToMaxCutoff([100, 1, 1], { fraction: 0.5, minKeep: 10 })
        .reason,
    ).toBe('below_min_keep');
  });
});
