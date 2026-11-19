import { CUTOFFS } from './config';
import { finiteScore, scoreOf } from './scores';
import {
  isKnownCode,
  isTier1,
  isTier2,
  NX,
  TIER1_CODES,
  TIER2_CODES,
  tier1Of,
} from './sune';
import {
  EmergencyBand,
  EmergencySignal,
  NeedState,
  RulesRequest,
  RulesSignals,
  UrgencyState,
} from './types';
import { cmp } from './util';

const URGENCY_DROP: UrgencyState = {
  value: 'U-X',
  source: 'default',
  state: 'drop',
};

export function emergencyBand(e: EmergencySignal | null): EmergencyBand {
  if (e === null || e === undefined) return 'none';
  const score = finiteScore(e.score);
  if (e.status === 'error' || score === undefined) return 'unknown';
  const { popup, soft } = CUTOFFS.emergency;
  if (e.floor_hit) return score >= popup ? 'popup' : 'soft';
  if (e.calm_context) return score >= soft ? 'soft' : 'none';
  if (e.dv_shelter && score < popup) return 'soft';
  if (score >= popup) return 'popup';
  if (score >= soft) return 'soft';
  return 'none';
}

export function urgencyState(
  req: RulesRequest,
  signals: RulesSignals,
): UrgencyState {
  // U-X (not yet known) is no answer: fall through to the model guess.
  if (req.urgency && req.urgency !== 'U-X') {
    return { value: req.urgency, source: 'caller', state: 'use' };
  }
  if (signals.needs.status !== 'ok' || !signals.urgency) {
    return { ...URGENCY_DROP };
  }
  const { level } = signals.urgency;
  const score = finiteScore(signals.urgency.score);
  if (score === undefined) {
    return { ...URGENCY_DROP };
  }
  if (score < CUTOFFS.urgency.drop) {
    return { ...URGENCY_DROP };
  }
  if (score < CUTOFFS.urgency.use) {
    return { value: 'U-X', source: 'default', state: 'ask' };
  }
  return { value: level, source: 'inferred', state: 'use' };
}

export interface NeedStatesResult {
  needs: NeedState[];
  boostNeeds: string[];
  nx: boolean;
  inferredAsk: NeedState[];
}

const byScoreDesc = (a: NeedState, b: NeedState) =>
  b.confidence - a.confidence || cmp(a.code, b.code);

export function confirmedCodes(req: RulesRequest): string[] {
  const out: string[] = [];
  for (const c of req.needs ?? []) {
    if (isKnownCode(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

export function passedCodes(req: RulesRequest): Set<string> {
  return new Set((req.passed_needs ?? []).filter(isKnownCode));
}

export function needStates(
  req: RulesRequest,
  signals: RulesSignals,
): NeedStatesResult {
  const confirmed = confirmedCodes(req);
  const passed = passedCodes(req);
  const skip = new Set([...confirmed, ...passed]);

  const states: NeedState[] = [];
  for (const code of confirmed) {
    states.push({ code, state: 'use', source: 'caller' });
  }

  const inferredUse: NeedState[] = [];
  const inferredAsk: NeedState[] = [];
  const scores = signals.needs.scores ?? {};
  if (signals.needs.status === 'ok') {
    for (const code of [...TIER1_CODES, ...TIER2_CODES]) {
      if (code === NX || skip.has(code)) continue;
      const s = scoreOf(scores, code);
      if (s >= CUTOFFS.needs.use) {
        inferredUse.push({
          code,
          state: 'use',
          source: 'inferred',
          confidence: s,
        });
      } else if (isTier2(code) && s >= CUTOFFS.needs.ask) {
        inferredAsk.push({
          code,
          state: 'ask',
          source: 'inferred',
          confidence: s,
        });
      }
    }
    inferredUse.sort(byScoreDesc);
    inferredAsk.sort(byScoreDesc);
  }
  states.push(...inferredUse, ...inferredAsk);

  const used = states
    .filter((s) => s.state === 'use' && s.code !== NX)
    .map((s) => s.code);
  const withChild = new Set(used.filter(isTier2).map((c) => tier1Of(c)));
  const boost = used.filter((c) => !(isTier1(c) && withChild.has(c)));

  const nx =
    used.length === 0 &&
    (confirmed.includes(NX) ||
      (signals.needs.status === 'ok' &&
        scoreOf(scores, NX) >= CUTOFFS.nx.label));

  return { needs: states, boostNeeds: boost, nx, inferredAsk };
}

export function areaRuleTarget(
  req: RulesRequest,
  signals: RulesSignals,
  states: NeedStatesResult,
): string | null {
  if (signals.needs.status !== 'ok') return null;
  const scores = signals.needs.scores ?? {};
  let best: string | null = null;
  let bestScore = -1;
  for (const code of TIER1_CODES) {
    const s = scoreOf(scores, code);
    if (s > bestScore || (s === bestScore && code < best)) {
      best = code;
      bestScore = s;
    }
  }
  if (best === null || bestScore < CUTOFFS.area.tier1Min) return null;
  const maxT2 = Math.max(0, ...TIER2_CODES.map((c) => scoreOf(scores, c)));
  if (maxT2 >= CUTOFFS.area.tier2Max) return null;
  const locked = new Set(confirmedCodes(req));
  for (const c of locked) {
    if (isTier2(c) && tier1Of(c) === best) return null;
  }
  if (states.needs.some((s) => s.state === 'use' && isTier2(s.code))) {
    return null;
  }
  return best;
}
