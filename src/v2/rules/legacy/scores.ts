/**
 * One rule for every model score the engine reads (needs, urgency, emergency):
 * a score counts only when it is a finite number. NaN, Infinity, a missing
 * value or a non-number is "no score", never a very high or very low one.
 */
export const finiteScore = (x: unknown): number | undefined =>
  typeof x === 'number' && Number.isFinite(x) ? x : undefined;

/** Score of one need code. Missing or non-finite reads as 0. */
export const scoreOf = (
  scores: Record<string, number> | undefined,
  code: string,
): number => finiteScore(scores?.[code]) ?? 0;
