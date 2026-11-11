import { emergencyBand, needStates, urgencyState } from './bands';
import { CUTOFFS, RULES_VERSION } from './config';
import { buildCandidates, countCodesOf } from './questions';
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
  return {
    rulesVersion: RULES_VERSION,
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
    countCodes: countCodesOf(candidates),
  };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function splitDistance(q: Question, total: number): number {
  const counts = q.options
    .filter((o) => typeof o.resultsCount === 'number')
    .map((o) => o.resultsCount);
  if (counts.length === 0 || total <= 0) return 0.5;
  return Math.abs(Math.max(...counts) / total - 0.5);
}

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
      const n = counts.byCode[o.value];
      if (typeof n === 'number') {
        if (n === 0) continue;
        o.resultsCount = n;
      }
      options.push(o);
    }
    q.options = options;
    const needOpts = options.filter((o) => o.value !== NX);
    if (needOpts.length === 0) continue;
    const counted = needOpts.filter((o) => typeof o.resultsCount === 'number');
    if (counted.length > 0 && counted.every((o) => o.resultsCount === total)) {
      continue;
    }
    kept.push(q);
  }

  kept.sort(
    (a, b) =>
      a.step - b.step ||
      splitDistance(a, total) - splitDistance(b, total) ||
      cmp(a.id, b.id),
  );
  return {
    rulesVersion: decision.rulesVersion,
    questions: kept.slice(0, CUTOFFS.maxQuestions),
  };
}
