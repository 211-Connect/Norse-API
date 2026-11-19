import { emergencyBand, needStates, urgencyState } from './bands';
import { CUTOFFS, RULES_VERSION } from './config';
import {
  asksNeeds,
  MIN_OPTIONS,
  ZERO_COUNT_FACTOR,
  buildCandidates,
  countCodesOf,
  noMatchQuestion,
} from './questions';
import { scoreOf } from './scores';
import {
  effort,
  priorityOf,
  round3,
  splitQuality,
  valueOf,
} from './importance';
import { needOptions } from './sune';
import {
  Clarification,
  Decision,
  FinalizeInput,
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
  const built = buildCandidates(req, used, tenant, band, urgency, states);
  // Off: no optional question (find_need, confirm_urgency).
  const candidates = aiOff
    ? built.filter((q) => q.type === 'emergency')
    : built;
  const countCodes = countCodesOf(candidates);
  const scores = used.needs.scores ?? {};
  // Decision 28: storable only when the check found nothing and the response
  // holds no emergency question (a caller U-0 adds one with band none).
  const hasEmergencyQuestion = candidates.some((q) => q.type === 'emergency');
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
    candidates,
    count_codes: countCodes,
    option_scores: Object.fromEntries(countCodes.map((c) => [c, 0])),
  };
}

export function finalize(
  decision: Decision,
  input: FinalizeInput,
): Clarification {
  const { counts, strong_text_match: strongTextMatch } = input;
  const total = counts.total;
  let questions: Question[] = JSON.parse(JSON.stringify(decision.candidates));

  if (strongTextMatch) {
    questions = questions.filter((q) => !asksNeeds(q));
  }

  const kept: Question[] = [];
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
    // Option score = classifier confidence x availability: count > 0 or not
    // counted (null) -> 1, count 0 -> 0.5. Sorted high to low (Lucas 2026-11-19).
    for (const o of options) {
      const factor = o.results_count === 0 ? ZERO_COUNT_FACTOR : 1;
      o.score = round3((o.score ?? 0) * factor);
    }
    options.sort((a, b) => b.score - a.score); // stable: ties keep build order
    q.options = options;
    const needOpts = needOptions(options);
    if (needOpts.length < MIN_OPTIONS) continue;
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
  return {
    rules_version: decision.rules_version,
    questions: kept.slice(0, CUTOFFS.maxQuestions),
  };
}
