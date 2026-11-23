import { confirmedCodes, passedCodes } from './bands';
import { CUTOFFS } from './config';
import { scoreOf } from './scores';
import { childrenOf, isTier2, NX, TIER1_CODES, tier1Of } from './sune';
import { NeedLevel, RulesRequest, RulesSignals } from './types';

export interface ClearArea {
  code: string;
  /** The kind of help inside the area is clear too. */
  kind_clear: boolean;
  /**
   * The kind is clear only because a Tier 2 score is likely (from
   * `kindClearMin`, below `needs.use`); the caller did not confirm it. Results
   * show, and the area asks a quiet 'which kind' question (D1, rule C).
   */
  likely_kind: boolean;
}

/**
 * Tier 1 areas the need is clear for (grid, step 3), the best first. Not
 * passed, and the caller confirmed the area or one of its kinds, or the model
 * scores the area at the Tier 1 cutoff, or one of its kinds at the Tier 2
 * cutoff. The kind is clear when the caller confirmed one, or a Tier 2 score
 * reaches `kindClearMin` (a likely kind: `likely_kind`). [] when the needs
 * signal failed.
 *
 * `matchNone` (D1, option D): the hits do not hold the query words. A Tier 2
 * score below `needs.use` then makes neither the area nor the kind clear; the
 * area stays clear only by the caller, or by its own Tier 1 score, and then
 * its kind is open.
 */
export function clearAreas(
  req: RulesRequest,
  signals: RulesSignals,
  matchNone = false,
): ClearArea[] {
  if (signals.needs.status !== 'ok') return [];
  const scores = signals.needs.scores ?? {};
  const confirmed = confirmedCodes(req);
  const passed = passedCodes(req);
  const out: (ClearArea & { sort: number })[] = [];
  for (const t of TIER1_CODES) {
    if (passed.has(t)) continue;
    const callerKind = confirmed.some((c) => isTier2(c) && tier1Of(c) === t);
    const best = Math.max(0, ...childrenOf(t).map((c) => scoreOf(scores, c)));
    // A likely kind (not sure enough to settle the kind) counts for nothing
    // when the hits do not hold the query words.
    const likely =
      !callerKind &&
      best >= CUTOFFS.area.kindClearMin &&
      best < CUTOFFS.needs.use;
    const ignoreKind = matchNone && !callerKind && best < CUTOFFS.needs.use;
    const byKind = !ignoreKind && (callerKind || best >= CUTOFFS.area.tier2Max);
    const clear =
      confirmed.includes(t) ||
      byKind ||
      scoreOf(scores, t) >= CUTOFFS.area.tier1Min;
    if (!clear) continue;
    out.push({
      code: t,
      kind_clear:
        callerKind || (!ignoreKind && best >= CUTOFFS.area.kindClearMin),
      likely_kind: likely && !ignoreKind,
      // An area made clear by a kind sorts by the better of the two scores.
      sort: byKind ? Math.max(scoreOf(scores, t), best) : scoreOf(scores, t),
    });
  }
  // Stable sort: ties keep vocabulary order.
  out.sort((a, b) => b.sort - a.sort);
  return out.map(({ code, kind_clear, likely_kind }) => ({
    code,
    kind_clear,
    likely_kind,
  }));
}

/** The grid's need measure (step 3). */
export function needLevel(
  req: RulesRequest,
  signals: RulesSignals,
  matchNone = false,
): NeedLevel {
  if (signals.needs.status !== 'ok') return 'unclear';
  if (confirmedCodes(req).includes(NX)) return 'kind';
  const areas = clearAreas(req, signals, matchNone);
  if (areas.length === 0) return 'unclear';
  return areas.every((a) => a.kind_clear) ? 'kind' : 'area';
}

/** Clear areas without a clear kind, best first (rule R3 asks about each). */
export const openAreas = (
  req: RulesRequest,
  signals: RulesSignals,
  matchNone = false,
): string[] =>
  clearAreas(req, signals, matchNone)
    .filter((a) => !a.kind_clear)
    .map((a) => a.code);

/** Clear areas whose kind is only likely (rule C: a quiet question beside the results). */
export const likelyAreas = (
  req: RulesRequest,
  signals: RulesSignals,
  matchNone = false,
): string[] =>
  clearAreas(req, signals, matchNone)
    .filter((a) => a.likely_kind)
    .map((a) => a.code);
