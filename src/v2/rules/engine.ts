import { emergencyBand, needStates, urgencyState } from './bands';
import { CUTOFFS, RULES_VERSION } from './config';
import { asksNeeds, buildCandidates, countCodesOf } from './questions';
import { scoreOf } from './scores';
import {
  effort,
  needUncertainty,
  priorityOf,
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
  // U-X means "urgency not yet known": same as no urgency sent (ISS-2499).
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
  // Off: no optional question (find_need, narrow, confirm_urgency).
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
    if (total === 0) continue;
    const options = [];
    for (const o of q.options) {
      if (counts.by_code !== null) {
        const n = counts.by_code[o.value] ?? 0;
        if (n === 0) continue;
        o.results_count = n;
      }
      options.push(o);
    }
    const dropped = options.length < q.options.length;
    q.options = options;
    const needOpts = needOptions(options);
    if (needOpts.length === 0) continue;
    // decide() measured uncertainty over every option; once 0-count options
    // are gone, measure it again over the ones the person will see.
    if (dropped) {
      q.uncertainty = needUncertainty(q, decision.option_scores);
    }
    const counted = needOpts.filter((o) => typeof o.results_count === 'number');
    if (counted.length > 0 && counted.every((o) => o.results_count === total)) {
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
  kept.sort((a, b) => b.priority - a.priority || cmp(a.id, b.id));
  return {
    rules_version: decision.rules_version,
    questions: kept.slice(0, CUTOFFS.maxQuestions),
  };
}
