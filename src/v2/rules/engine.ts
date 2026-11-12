import { emergencyBand, needStates, urgencyState } from './bands';
import { CUTOFFS, RULES_VERSION } from './config';
import { buildCandidates, countCodesOf } from './questions';
import {
  effort,
  needUncertainty,
  priorityOf,
  splitQuality,
  valueOf,
} from './importance';
import { NX } from './sune';
import {
  Clarification,
  Decision,
  FinalizeInput,
  Question,
  RulesRequest,
  RulesSignals,
  TenantContext,
} from './types';

export function decide(
  req: RulesRequest,
  signals: RulesSignals,
  tenant: TenantContext = {},
): Decision {
  const band = emergencyBand(signals.emergency);
  const urgency = urgencyState(req, signals.needs);
  const states = needStates(req, signals);
  const candidates = buildCandidates(
    req,
    signals,
    tenant,
    band,
    urgency,
    states,
  );
  const countCodes = countCodesOf(candidates);
  const scores = signals.needs.scores ?? {};
  return {
    rulesVersion: RULES_VERSION,
    optionScores: Object.fromEntries(
      countCodes.map((c) => [c, scores[c] ?? 0]),
    ),
    emergency: {
      band,
      showHotline: band === 'popup' || req.urgency === 'U-0',
    },
    cacheable: band === 'none' && signals.needs.status === 'ok',
    needs: states.needs,
    boostNeeds: states.boostNeeds,
    nx: states.nx,
    urgency,
    candidates,
    countCodes,
  };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function finalize(
  decision: Decision,
  input: FinalizeInput,
): Clarification {
  const { counts, strongTextMatch } = input;
  const total = counts.total;
  let questions: Question[] = JSON.parse(JSON.stringify(decision.candidates));

  if (strongTextMatch) {
    questions = questions.filter((q) => q.parameter !== 'needs');
  }

  const kept: Question[] = [];
  for (const q of questions) {
    if (q.parameter !== 'needs') {
      kept.push(q);
      continue;
    }
    if (total === 0) continue;
    const options = [];
    for (const o of q.options) {
      if (o.value === NX) {
        options.push(o);
        continue;
      }
      if (counts.byCode !== null) {
        const n = counts.byCode[o.value] ?? 0;
        if (n === 0) continue;
        o.resultsCount = n;
      }
      options.push(o);
    }
    const dropped = options.length < q.options.length;
    q.options = options;
    const needOpts = options.filter((o) => o.value !== NX);
    if (needOpts.length === 0) continue;
    // decide() measured uncertainty over every option; once 0-count options
    // are gone, measure it again over the ones the person will see.
    if (dropped) {
      q.uncertainty = needUncertainty(q, decision.optionScores);
    }
    const counted = needOpts.filter((o) => typeof o.resultsCount === 'number');
    if (counted.length > 0 && counted.every((o) => o.resultsCount === total)) {
      continue;
    }
    kept.push(q);
  }

  for (const q of kept) {
    q.value = valueOf(
      q.uncertainty,
      effort(q),
      q.parameter === 'needs' ? splitQuality(q, total) : 1,
    );
    q.priority = priorityOf(q.importance, q.value);
  }
  kept.sort((a, b) => b.priority - a.priority || cmp(a.id, b.id));
  return {
    rulesVersion: decision.rulesVersion,
    questions: kept.slice(0, CUTOFFS.maxQuestions),
  };
}
