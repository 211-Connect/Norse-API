import { emergencyBand, needStates, urgencyState } from './bands';
import { CUTOFFS, PHONE_LINE, RULES_VERSION, STEMS } from './config';
import { likelyAreas, needLevel, openAreas } from './need-level';
import {
  asksNeeds,
  hasEnoughOptions,
  COUNT_BONUS_WEIGHT,
  buildCandidates,
  countCodesOf,
  noMatchQuestion,
} from './questions';
import { Match } from './match';
import { scoreOf } from './scores';
import {
  blocksResults,
  effort,
  priorityOf,
  round3,
  splitQuality,
  valueOf,
} from './importance';
import { needOptions, TIER1_CODES } from './sune';
import {
  Clarification,
  Decision,
  FinalizeInput,
  GridRule,
  Hotline,
  Question,
  RulesRequest,
  RulesSignals,
  TenantContext,
} from './types';
import { cmp } from './util';

export function decide(
  request: RulesRequest,
  signals: RulesSignals,
  tenant: TenantContext = {},
): Decision {
  // U-X means "time not known": same as no urgency sent (ISS-2499).
  const req: RulesRequest =
    request.urgency === 'U-X' ? { ...request, urgency: undefined } : request;
  const aiOff = tenant.ai_classification === 'off';
  // AI classification off (question 14): the need and urgency guesses are
  // dropped; the emergency signal stays, so the check always runs.
  const used: RulesSignals = aiOff
    ? { needs: { status: 'ok', scores: {} }, emergency: signals.emergency }
    : signals;
  const band = emergencyBand(used.emergency);
  const urgency = urgencyState(req, used);
  const states = needStates(req, used);
  const built = buildCandidates(req, used, tenant, band, urgency);
  // Off: no optional question (find_need, confirm_urgency).
  const candidates = aiOff
    ? built.filter((q) => q.type === 'emergency')
    : built;
  const scores = used.needs.scores ?? {};
  // Decision 28: storable only when the check found nothing and the response
  // holds no emergency question (a caller U-0 adds one with band none).
  const hasEmergencyQuestion = candidates.some((q) => q.type === 'emergency');
  const level = needLevel(req, used);
  // D1 (option D): the match is known only after the search. When the hits
  // hold none of the query words, a likely kind makes neither area nor kind
  // clear. The decision keeps both outcomes; finalize picks one.
  const noneLevel = needLevel(req, used, true);
  const noneOpen = openAreas(req, used, true);
  const noneLikely = likelyAreas(req, used, true);
  const open = level === 'area' ? openAreas(req, used) : [];
  const likely = level === 'unclear' ? [] : likelyAreas(req, used);
  const differs =
    noneLevel !== level ||
    noneOpen.join() !== openAreas(req, used).join() ||
    noneLikely.join() !== likelyAreas(req, used).join();
  const noneCandidates = differs
    ? buildCandidates(req, used, tenant, band, urgency, true)
    : [];
  const noneFinal = aiOff
    ? noneCandidates.filter((q) => q.type === 'emergency')
    : noneCandidates;
  const allCandidates = [...candidates, ...noneFinal];
  const countCodes = countCodesOf(allCandidates);
  return {
    rules_version: RULES_VERSION,
    option_scores: Object.fromEntries(
      countCodes.map((c) => [c, scoreOf(scores, c)]),
    ),
    emergency_band: band,
    cacheable:
      band === 'none' && !hasEmergencyQuestion && used.needs.status === 'ok',
    needs: states.needs,
    boost_needs: states.boostNeeds,
    nx: states.nx,
    urgency,
    need_level: level,
    open_areas: open,
    likely_areas: likely,
    ...(differs && {
      if_match_none: {
        need_level: noneLevel,
        open_areas: noneLevel === 'area' ? noneOpen : [],
        likely_areas: noneLevel === 'unclear' ? [] : noneLikely,
        candidates: noneFinal,
      },
    }),
    candidates,
    count_codes: countCodes,
  };
}

/**
 * The decision for a weak match (ISS-2796, Lucas 2026-11-18): the emergency
 * question (when the decision has one) and the no_match question (none when
 * clarify=never or no option is left). Counts and option scores follow that question; the rest is copied.
 */
export function weakMatchDecision(
  decision: Decision,
  req: RulesRequest,
  tenant: TenantContext,
): Decision {
  // The emergency question stays (a soft card can sit next to a weak match).
  const emergency = decision.candidates.filter((c) => c.type === 'emergency');
  const q = req.clarify === 'never' ? null : noMatchQuestion(req, tenant);
  const candidates = [...emergency, ...(q ? [q] : [])];
  const countCodes = countCodesOf(candidates);
  return {
    ...decision,
    if_match_none: undefined,
    candidates,
    count_codes: countCodes,
    option_scores: Object.fromEntries(countCodes.map((c) => [c, 0])),
  };
}

/** Shannon entropy of the option scores normalized to sum 1; 0 when they sum to 0. */
export function scoreEntropy(options: { score?: number }[]): number {
  const total = options.reduce((t, o) => t + (o.score ?? 0), 0);
  if (!(total > 0)) return 0;
  let h = 0;
  for (const o of options) {
    const p = (o.score ?? 0) / total;
    if (p > 0) h -= p * Math.log(p);
  }
  return h;
}

/**
 * The decision for the match found (D1, option D): match 'none' swaps in the
 * need level and candidates computed without the likely kinds.
 */
function forMatch(decision: Decision, input: FinalizeInput): Decision {
  if (input.weak) return decision;
  if (input.match !== 'none' || !decision.if_match_none) return decision;
  return { ...decision, ...decision.if_match_none };
}

/**
 * The grid rule for a decision and the finalize input (rules-signals-2026-11-23.md):
 * step 2 (no results) first, then R1 to R5 by the match and the need level.
 */
export function gridRule(base: Decision, input: FinalizeInput): GridRule {
  const decision = forMatch(base, input);
  if (input.weak || input.counts.total === 0) return 'no_results';
  const match: Match = input.match ?? 'spread';
  if (match === 'concentrated') return 'R1';
  if (decision.need_level === 'kind' || decision.need_level === 'likely') {
    return 'R2';
  }
  if (decision.need_level === 'area') return 'R3';
  return match === 'none' ? 'R5' : 'R4';
}

/**
 * Rule R5 (no clear need, the hits do not hold the query words): the start
 * question only, with the notice and the phone line. R5 is not final (Lucas
 * 2026-11-23 13:50): every effect of R5 lives here, so a later change touches
 * one place.
 */
function applyR5(questions: Question[]): {
  questions: Question[];
  notice: { kind: 'may_not_match'; text: string };
  phone_line: Hotline;
} {
  return {
    questions: questions.filter((q) => !asksNeeds(q) || q.id === 'start'),
    notice: { kind: 'may_not_match', text: STEMS.notice },
    phone_line: PHONE_LINE,
  };
}

/** The find_need questions that stay for a rule, before the counts. R5 is applyR5. */
function filterByRule(
  questions: Question[],
  rule: GridRule,
  likely: string[],
): Question[] {
  const keepNeed = (q: Question): boolean => {
    switch (rule) {
      case 'no_results':
        return q.id === 'no_match';
      case 'R3':
        return q.id.startsWith('area:');
      case 'R2':
        // Rule C: a likely kind keeps its quiet question beside the results.
        return likely.some((t) => q.id === `area:${t}`);
      case 'R4': {
        // spread, else the one in-play area question, else start.
        const pick =
          questions.find((c) => c.id === 'spread') ??
          questions.find((c) => c.id.startsWith('area:')) ??
          questions.find((c) => c.id === 'start');
        return q === pick;
      }
      default: // R1, R2, R5 (start only, see applyR5)
        return false;
    }
  };
  return questions.filter((q) => !asksNeeds(q) || keepNeed(q));
}

/**
 * Rule R3 asks one question for each open area. The area questions take the
 * slots they hold after the sort, most uncertain first: highest entropy of
 * its option scores, then more results across its options, then the higher
 * Tier 1 confidence, then vocabulary order (Lucas 2026-11-19, 2026-11-23).
 */
function sortAreaQuestions(qs: Question[], decision: Decision): Question[] {
  const conf = (q: Question) =>
    decision.needs.find((n) => `area:${n.code}` === q.id)?.confidence ?? 0;
  const results = (q: Question) =>
    q.options.reduce((t, o) => t + (o.results_count ?? 0), 0);
  const vocab = (q: Question) =>
    TIER1_CODES.indexOf(q.id.slice('area:'.length));
  const eq = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  return [...qs].sort((a, b) => {
    const dh = scoreEntropy(b.options) - scoreEntropy(a.options);
    if (!eq(dh, 0)) return dh;
    if (results(a) !== results(b)) return results(b) - results(a);
    if (!eq(conf(a), conf(b))) return conf(b) - conf(a);
    return vocab(a) - vocab(b);
  });
}

function orderAreaQuestions(kept: Question[], decision: Decision): Question[] {
  const slots = kept.flatMap((q, i) => (q.id.startsWith('area:') ? [i] : []));
  if (slots.length < 2) return kept;
  // The one 'high' area question (D2) goes first, then the entropy order.
  const ordered = sortAreaQuestions(
    slots.map((i) => kept[i]),
    decision,
  ).sort(
    (a, b) => Number(b.importance === 'high') - Number(a.importance === 'high'),
  );
  const out = [...kept];
  slots.forEach((slot, n) => (out[slot] = ordered[n]));
  return out;
}

export function finalize(base: Decision, input: FinalizeInput): Clarification {
  const decision = forMatch(base, input);
  const { counts } = input;
  const total = counts.total;
  const rule = gridRule(decision, input);
  let questions: Question[] = JSON.parse(JSON.stringify(decision.candidates));
  let notice: Clarification['notice'];
  let phone_line: Clarification['phone_line'];

  if (rule === 'R5') {
    ({ questions, notice, phone_line } = applyR5(questions));
  } else {
    questions = filterByRule(questions, rule, decision.likely_areas);
    if (rule === 'no_results') phone_line = PHONE_LINE;
  }

  let kept: Question[] = [];
  for (const q of questions) {
    if (!asksNeeds(q)) {
      kept.push(q);
      continue;
    }
    if (total !== null && total === 0) continue;
    const options = [];
    for (const o of q.options) {
      if (counts.by_code !== null) {
        // A 0-count option stays: the person still sees it, with its 0.
        o.results_count = counts.by_code[o.value] ?? 0;
      }
      options.push(o);
    }
    // Option score = classifier confidence + 0.3 * log(1+count) / log(1+max
    // count among this question's options). A null or 0 count adds 0; a 0
    // count stays listed. Sorted high to low (Lucas 2026-11-19).
    const maxCount = Math.max(0, ...options.map((o) => o.results_count ?? 0));
    for (const o of options) {
      const bonus =
        maxCount > 0 && o.results_count
          ? (COUNT_BONUS_WEIGHT * Math.log(1 + o.results_count)) /
            Math.log(1 + maxCount)
          : 0;
      o.score = round3((o.score ?? 0) + bonus);
    }
    options.sort((a, b) => b.score - a.score); // stable: ties keep build order
    q.options = options;
    const needOpts = needOptions(options);
    if (!hasEnoughOptions(needOpts)) continue;
    const counted = needOpts.filter((o) => typeof o.results_count === 'number');
    if (
      total !== null &&
      counted.length > 0 &&
      counted.every((o) => o.results_count === total)
    ) {
      continue;
    }
    kept.push(q);
  }

  // D2: in R3 the most uncertain open area keeps 'high'; every other area
  // question is 'medium'. The order is the one orderAreaQuestions gives.
  if (rule === 'R3') {
    const open = kept.filter(
      (q) =>
        q.id.startsWith('area:') &&
        !decision.likely_areas.includes(q.id.slice('area:'.length)),
    );
    const first = open.length > 0 ? sortAreaQuestions(open, decision)[0] : null;
    for (const q of kept) {
      if (q.id.startsWith('area:') && q !== first) q.importance = 'medium';
    }
  }

  // Guide cap: enough ids asked for this query means no more questions before
  // the results. The danger question is a safety path and is never cut. Cut
  // before the top 3, so a question beside the results takes the free place.
  if (new Set(input.asked ?? []).size >= CUTOFFS.maxBeforeResults) {
    kept = kept.filter((q) => q.type === 'emergency' || !blocksResults(q));
  }

  for (const q of kept) {
    for (const o of q.options) o.results_count ??= null;
    q.value = valueOf(
      q.uncertainty,
      effort(q),
      asksNeeds(q) ? splitQuality(q, total) : 1,
    );
    q.priority = priorityOf(q.importance, q.value);
  }
  // The emergency question is always first, in both bands (a soft-band one is
  // only `high`, so priority alone could rank another question above it).
  const emergencyFirst = (q: Question) => (q.type === 'emergency' ? 0 : 1);
  kept.sort(
    (a, b) =>
      emergencyFirst(a) - emergencyFirst(b) ||
      b.priority - a.priority ||
      cmp(a.id, b.id),
  );
  if (rule === 'R3') {
    kept = orderAreaQuestions(kept, decision);
  }
  // The notice says "pick what you need below": it needs that question. Without
  // one (clarify=never, AI off, a failed needs call, the guide cap) R5 says nothing.
  if (rule === 'R5' && !kept.some(asksNeeds)) {
    notice = undefined;
    phone_line = undefined;
  }
  return {
    rules_version: decision.rules_version,
    questions: kept.slice(0, CUTOFFS.maxQuestions),
    ...(notice && { notice }),
    ...(phone_line && { phone_line }),
  };
}
