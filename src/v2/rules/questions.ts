import {
  areaRuleTarget,
  confirmedCodes,
  NeedStatesResult,
  passedCodes,
} from './bands';
import {
  CUTOFFS,
  DEFAULT_HOTLINES,
  DEFAULT_TOP_AREAS,
  LABELS,
  STEMS,
} from './config';
import { effort, priorityOf, uncertainty, valueOf } from './importance';
import { scoreOf } from './scores';
import {
  childrenOf,
  displayOf,
  isTier1,
  isTier2,
  isKnownCode,
  allTier1,
  NX,
  tier1Of,
} from './sune';
import {
  EmergencyBand,
  Question,
  QuestionOption,
  RulesRequest,
  RulesSignals,
  TenantContext,
  UrgencyState,
} from './types';

const urgencyOption = (v: string): QuestionOption => ({
  value: v,
  label: LABELS.urgency[v],
});
const needOption = (code: string): QuestionOption => ({
  value: code,
  label: displayOf(code),
});
const nxOption = (): QuestionOption => ({ value: NX, label: LABELS.nx });

const needsFlags = {
  multi_select: true,
  allow_other: true,
  none_of_these: true,
};
const urgencyFlags = {
  multi_select: false,
  allow_other: false,
  none_of_these: false,
};

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function buildCandidates(
  req: RulesRequest,
  signals: RulesSignals,
  tenant: TenantContext,
  band: EmergencyBand,
  urgency: UrgencyState,
  states: NeedStatesResult,
): Question[] {
  const out: Question[] = [];

  // 1. emergency
  const hasEmergency = (band === 'popup' || band === 'soft') && !req.urgency;
  if (hasEmergency) {
    out.push({
      id: 'emergency',
      type: 'emergency',
      level: 'red',
      importance: 'critical',
      value: 0,
      priority: 0,
      uncertainty: 0,
      reason: 'emergency_band',
      step: 0,
      parameter: 'urgency',
      stem: STEMS.emergency,
      options: ['U-0', 'U-1', 'U-3'].map(urgencyOption),
      ...urgencyFlags,
      hotlines: tenant.hotlines?.length ? tenant.hotlines : DEFAULT_HOTLINES,
    });
  }

  // 2. time questions
  if (urgency.state === 'ask' && !hasEmergency) {
    const level = signals.urgency?.level;
    if (level === 'U-1') {
      out.push({
        id: 'urgency_today',
        type: 'confirm_urgency',
        level: 'orange',
        importance: 'high',
        value: 0,
        priority: 0,
        uncertainty: 0,
        reason: 'urgency_unsure',
        step: 1,
        parameter: 'urgency',
        stem: STEMS.today,
        options: ['U-1', 'U-2', 'U-3'].map(urgencyOption),
        ...urgencyFlags,
      });
    } else {
      out.push({
        id: 'urgency_time',
        type: 'confirm_urgency',
        level: 'low',
        importance: 'low',
        value: 0,
        priority: 0,
        uncertainty: 0,
        reason: 'urgency_unsure',
        step: 5,
        parameter: 'urgency',
        stem: STEMS.time,
        options: ['U-1', 'U-2', 'U-4', 'U-3'].map(urgencyOption),
        ...urgencyFlags,
      });
    }
  }

  // needs questions
  const confirmed = confirmedCodes(req);
  const passed = passedCodes(req);
  if (signals.needs.status === 'ok' && !confirmed.includes(NX)) {
    const scores = signals.needs.scores ?? {};
    const sc = (c: string) => scoreOf(scores, c);
    const lockedAreas = new Set<string>();
    for (const c of confirmed) {
      if (isTier2(c)) lockedAreas.add(tier1Of(c));
    }
    const eligible = (c: string) =>
      !confirmed.includes(c) && !passed.has(c) && !lockedAreas.has(tier1Of(c));
    const byScore = (a: string, b: string) => sc(b) - sc(a) || cmp(a, b);
    const topChildren = (t1: string) =>
      childrenOf(t1)
        .filter(eligible)
        .sort(byScore)
        .slice(0, CUTOFFS.optionsPerQuestion);

    const areaQuestion = (
      t1: string,
      reason: 'area_confirmed' | 'area_only',
    ): Question | null => {
      const options = topChildren(t1).map(needOption);
      if (options.length === 0) return null;
      return {
        id: `area:${t1}`,
        type: 'find_need',
        level: 'orange',
        importance: 'high',
        value: 0,
        priority: 0,
        uncertainty: 0,
        reason,
        step: 3,
        parameter: 'needs',
        stem: STEMS.area.replace('{area}', displayOf(t1)),
        options,
        ...needsFlags,
      };
    };

    // 3. area confirmed
    const areaConfirmed = confirmed.filter(
      (c) =>
        isTier1(c) && !confirmed.some((d) => isTier2(d) && tier1Of(d) === c),
    );
    let areaQuestionCount = 0;
    // Areas that already have an area question: their needs are not offered
    // again in a narrow question of the same response.
    const askedAreas = new Set<string>();
    for (const t1 of areaConfirmed) {
      const q = areaQuestion(t1, 'area_confirmed');
      if (q) {
        out.push(q);
        areaQuestionCount++;
        askedAreas.add(t1);
      }
    }

    // 4. area rule
    const target = areaRuleTarget(req, signals, states);
    let areaRuleFired = false;
    if (target && !lockedAreas.has(target) && !areaConfirmed.includes(target)) {
      const q = areaQuestion(target, 'area_only');
      if (q) {
        out.push(q);
        areaQuestionCount++;
        areaRuleFired = true;
      }
    }

    if (!areaRuleFired) {
      // 5. start
      if (
        confirmed.length === 0 &&
        states.needs.length === 0 &&
        areaQuestionCount === 0
      ) {
        const eligibleT1 = allTier1().filter(eligible).sort(byScore);
        let picks: string[];
        if (
          eligibleT1.length > 0 &&
          sc(eligibleT1[0]) >= CUTOFFS.start.modelAreasMin
        ) {
          picks = eligibleT1.slice(0, CUTOFFS.optionsPerQuestion);
        } else {
          const pool = [
            ...(tenant.top_areas ?? []).filter((c) => isTier1(c)),
            ...DEFAULT_TOP_AREAS,
          ];
          picks = [];
          for (const c of pool) {
            if (eligible(c) && !picks.includes(c)) picks.push(c);
            if (picks.length === CUTOFFS.optionsPerQuestion) break;
          }
        }
        const options = picks.map(needOption);
        if (sc(NX) >= CUTOFFS.nx.label) options.push(nxOption());
        if (options.length > 0)
          out.push({
            id: 'start',
            type: 'find_need',
            level: 'orange',
            importance: 'high',
            value: 0,
            priority: 0,
            uncertainty: 0,
            reason: 'no_need',
            step: 2,
            parameter: 'needs',
            stem: STEMS.start,
            options,
            ...needsFlags,
          });
      }

      // 6. narrow
      // ISS-2697 rule: when a Tier 2 need is already used (any source), the
      // narrow questions about other unsure needs go to the bottom of the order.
      const sureTier2 = states.needs.some(
        (s) => s.state === 'use' && isTier2(s.code),
      );
      const asks = states.inferredAsk
        .map((s) => s.code)
        .filter((c) => eligible(c) && !askedAreas.has(tier1Of(c)))
        .sort(byScore);
      const g1 = asks.slice(0, CUTOFFS.optionsPerQuestion).map(needOption);
      const g2 = asks
        .slice(CUTOFFS.optionsPerQuestion, 2 * CUTOFFS.optionsPerQuestion)
        .map(needOption);
      if (g1.length > 0) {
        if (sc(NX) >= CUTOFFS.nx.label) g1.push(nxOption());
        out.push({
          id: 'narrow:1',
          type: 'narrow',
          level: 'low',
          importance: sureTier2 ? 'low' : 'medium',
          value: 0,
          priority: 0,
          uncertainty: 0,
          reason: 'unsure_needs',
          step: sureTier2 ? 7 : 4,
          parameter: 'needs',
          stem: sureTier2 ? STEMS.narrowAlso : STEMS.narrow,
          options: g1,
          ...needsFlags,
        });
      }
      if (g2.length > 0) {
        out.push({
          id: 'narrow:2',
          type: 'narrow',
          level: 'low',
          importance: 'low',
          value: 0,
          priority: 0,
          uncertainty: 0,
          reason: 'unsure_needs',
          step: sureTier2 ? 8 : 6,
          parameter: 'needs',
          stem: sureTier2 ? STEMS.narrowAlso : STEMS.narrow,
          options: g2,
          ...needsFlags,
        });
      }
    }
  }

  for (const q of out) {
    q.uncertainty = uncertainty(q, signals);
    q.value = valueOf(q.uncertainty, effort(q), 1);
    q.priority = priorityOf(q.importance, q.value);
  }

  // 7. clarify never
  if (req.clarify === 'never') return out.filter((q) => q.id === 'emergency');
  return out;
}

export function countCodesOf(candidates: Question[]): string[] {
  const set = new Set<string>();
  for (const q of candidates) {
    if (q.parameter !== 'needs') continue;
    for (const o of q.options) {
      if (o.value !== NX && isKnownCode(o.value)) set.add(o.value);
    }
  }
  return [...set].sort(cmp);
}
