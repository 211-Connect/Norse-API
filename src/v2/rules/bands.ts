import { CUTOFFS } from './config';
import {
  allTier1,
  allTier2,
  isKnownCode,
  isTier1,
  isTier2,
  NX,
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

export function emergencyBand(e: EmergencySignal | null): EmergencyBand {
  if (e === null || e === undefined) return 'none';
  if (
    e.status === 'error' ||
    typeof e.score !== 'number' ||
    !Number.isFinite(e.score)
  )
    return 'unknown';
  const { popup, soft } = CUTOFFS.emergency;
  if (e.floor_hit) return e.score >= popup ? 'popup' : 'soft';
  if (e.calm_context) return e.score >= soft ? 'soft' : 'none';
  if (e.dv_shelter && e.score < popup) return 'soft';
  if (e.score >= popup) return 'popup';
  if (e.score >= soft) return 'soft';
  return 'none';
}

export function urgencyState(
  req: RulesRequest,
  signals: RulesSignals,
): UrgencyState {
  if (req.urgency) {
    return { value: req.urgency, source: 'caller', state: 'use' };
  }
  if (signals.needs.status !== 'ok' || !signals.urgency) {
    return { value: 'U-X', source: 'default', state: 'drop' };
  }
  const { score, level } = signals.urgency;
  if (!Number.isFinite(score)) {
    return { value: 'U-X', source: 'default', state: 'drop' };
  }
  if (score < CUTOFFS.urgency.drop) {
    return { value: 'U-X', source: 'default', state: 'drop' };
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
  b.confidence - a.confidence ||
  (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);

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
    for (const code of [...allTier1(), ...allTier2()]) {
      if (code === NX || skip.has(code)) continue;
      const s = scores[code] ?? 0;
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

  let boost = states
    .filter((s) => s.state === 'use' && s.code !== NX)
    .map((s) => s.code);
  const withChild = new Set(boost.filter(isTier2).map((c) => tier1Of(c)));
  boost = boost.filter((c) => !(isTier1(c) && withChild.has(c)));

  const anyUseBesidesNx = states.some(
    (s) => s.state === 'use' && s.code !== NX,
  );
  const nx =
    !anyUseBesidesNx &&
    (confirmed.includes(NX) ||
      (signals.needs.status === 'ok' && (scores[NX] ?? 0) >= CUTOFFS.nx.label));

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
  for (const code of allTier1()) {
    const s = scores[code] ?? 0;
    if (s > bestScore || (s === bestScore && code < best)) {
      best = code;
      bestScore = s;
    }
  }
  if (best === null || bestScore < CUTOFFS.area.tier1Min) return null;
  const maxT2 = Math.max(0, ...allTier2().map((c) => scores[c] ?? 0));
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
