import { confirmedCodes, passedCodes } from './bands';
import { likelyAreas, needLevel, openAreas } from './need-level';
import {
  CUTOFFS,
  DEFAULT_HOTLINES,
  DEFAULT_TOP_AREAS,
  LABELS,
  STEMS,
} from './config';
import { effort, priorityOf, uncertainty, valueOf } from './importance';
import { needText } from './need-text';
import { scoreOf } from './scores';
import {
  childrenOf,
  displayOf,
  isTier2,
  isKnownCode,
  needOptions,
  NX,
  TIER1_CODES,
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
import { cmp } from './util';

// Key order follows ADR 0039 Decision 55: {label, parameter, value}.
const urgencyOption = (v: string): QuestionOption => ({
  label: LABELS.urgency[v],
  parameter: 'urgency',
  value: v,
});
// Lucas 2026-11-17 (final): the emergency question has 3 answers, each
// writes urgency: danger = U-0, safe but help today = U-1, safe but help
// within a week = U-2. A caller U-1 to U-4 then hides the card (Decision 51).
// ADR 0039 Decision 50 needs a follow-up line that lists the 3 answers.
const EMERGENCY_OPTIONS: QuestionOption[] = [
  { label: LABELS.emergency.yes, parameter: 'urgency', value: 'U-0' },
  { label: LABELS.emergency.safeToday, parameter: 'urgency', value: 'U-1' },
  { label: LABELS.emergency.safeSoon, parameter: 'urgency', value: 'U-2' },
];
/** A question never has fewer options than this (Lucas 2026-11-19: no 1-option questions). */
export const MIN_OPTIONS = 2;

/** Weight of the count bonus in the option score (finalize), Lucas 2026-11-19. */
export const COUNT_BONUS_WEIGHT = 0.3;

/**
 * Whether a need question keeps enough options (finalize). Options with 0
 * services count too: one option with services next to them is still a real
 * choice (decided by David 2026-11-23).
 */
export const hasEnoughOptions = (options: unknown[]): boolean =>
  options.length >= MIN_OPTIONS;

/**
 * Tier 1 areas the model puts in play for the query (score of 0.05 or more),
 * best score first, ties in vocabulary order. Codes the caller confirmed or
 * passed are left out. [] when the needs signal failed.
 */
export function areasInPlay(
  req: RulesRequest,
  signals: RulesSignals,
): string[] {
  if (signals.needs.status !== 'ok') return [];
  const scores = signals.needs.scores ?? {};
  const confirmed = confirmedCodes(req);
  const passed = passedCodes(req);
  return TIER1_CODES.filter(
    (c) =>
      !confirmed.includes(c) &&
      !passed.has(c) &&
      scoreOf(scores, c) >= CUTOFFS.spread.areaInPlayMin,
  ).sort((a, b) => scoreOf(scores, b) - scoreOf(scores, a));
}

/**
 * Rule R4's areas in play: `areasInPlay`, but only for a query of 1 to
 * `CUTOFFS.spread.maxContentWords` content words (else none).
 */
export function areasInPlayForSpread(
  req: RulesRequest,
  signals: RulesSignals,
): string[] {
  const n = req.content_words?.length ?? 0;
  return n >= 1 && n <= CUTOFFS.spread.maxContentWords
    ? areasInPlay(req, signals)
    : [];
}

/** `score` is the classifier score of the need, 0..1 (0 when the model gave none). */
const needOption = (
  code: string,
  score: number,
  tenant: TenantContext,
): QuestionOption => {
  const text = needText(code, {
    tenantId: tenant.tenant_id,
    locale: tenant.locale,
  });
  return {
    label: text.display,
    description: text.description,
    parameter: 'needs',
    value: code,
    score,
  };
};

/** A question that offers need codes (start, area, no_match). */
export const asksNeeds = (q: Question): boolean => q.type === 'find_need';

const hotlinesOf = (tenant: TenantContext) =>
  tenant.hotlines?.length ? tenant.hotlines : DEFAULT_HOTLINES;

/**
 * Emergency question from the emergency band (ADR 0039 Decision 54). Both bands use the same stem and
 * labels. "Yes" sends `urgency=U-0` (the next call shows only the hotlines,
 * callerU0EmergencyQuestion); "safe" writes nothing to the URL.
 */
// Lucas 2026-11-13: "bring back the popup if the model is very sure". The
// strong band is critical (popup), the soft band high (in-page card).
const bandEmergencyQuestion = (
  tenant: TenantContext,
  band: EmergencyBand,
): Question =>
  question({
    id: 'emergency',
    type: 'emergency',
    importance: band === 'popup' ? 'critical' : 'high',
    reason: 'emergency_band',
    step: 0,
    stem: STEMS.emergency,
    options: EMERGENCY_OPTIONS.map((o) => ({ ...o })),
    ...urgencyFlags,
    hotlines: hotlinesOf(tenant),
  });

/**
 * Caller sent `urgency=U-0` (also the "Yes, I am in danger" answer). ADR 0039
 * Decision 50, confirmed by Lucas 2026-11-12: the emergency question first,
 * with the hotline numbers and no options, whatever the band; the results stay.
 */
export const callerU0EmergencyQuestion = (tenant: TenantContext): Question =>
  question({
    id: 'emergency',
    type: 'emergency',
    importance: 'critical',
    reason: 'emergency_band',
    step: 0,
    stem: STEMS.emergency,
    options: [],
    ...urgencyFlags,
    hotlines: hotlinesOf(tenant),
  });

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

/** A candidate question; the scoring loop in buildCandidates sets value, priority and uncertainty. */
const question = ({
  id,
  type,
  importance,
  ...rest
}: Omit<Question, 'value' | 'priority' | 'uncertainty'>): Question => ({
  id,
  type,
  importance,
  value: 0,
  priority: 0,
  uncertainty: 0,
  ...rest,
});

/**
 * Tier 1 codes for a question the model cannot rank: the global default
 * areas; skips codes that are not `eligible`, no duplicates, at most
 * `optionsPerQuestion`.
 */
function fallbackAreas(eligible: (code: string) => boolean): string[] {
  const picks: string[] = [];
  for (const c of DEFAULT_TOP_AREAS) {
    if (eligible(c) && !picks.includes(c)) picks.push(c);
    if (picks.length === CUTOFFS.optionsPerQuestion) break;
  }
  return picks;
}

/**
 * The question for a weak match (ISS-2796, Lucas 2026-11-18): the text found
 * nothing good, so ask what the person needs. Same options as the `start`
 * fallback. "Other" opens a text box whose text joins `query` (ADR 0039
 * Decision 7). The model cannot vouch for it: uncertainty is 1. Null when no
 * option is left.
 */
export function noMatchQuestion(
  req: RulesRequest,
  tenant: TenantContext,
): Question | null {
  const confirmed = confirmedCodes(req);
  const passed = passedCodes(req);
  const picks = fallbackAreas((c) => !confirmed.includes(c) && !passed.has(c));
  if (picks.length < MIN_OPTIONS) return null;
  const q = question({
    id: 'no_match',
    type: 'find_need',
    importance: 'high',
    reason: 'weak_match',
    step: 2,
    stem: STEMS.noMatch,
    options: picks.map((c) => needOption(c, 0, tenant)),
    ...needsFlags,
  });
  q.uncertainty = 1;
  q.value = valueOf(1, effort(q), 1);
  q.priority = priorityOf('high', q.value);
  return q;
}

export function buildCandidates(
  req: RulesRequest,
  signals: RulesSignals,
  tenant: TenantContext,
  band: EmergencyBand,
  urgency: UrgencyState,
  /** The hits do not hold the query words (D1): a likely kind settles nothing. */
  matchNone = false,
): Question[] {
  const out: Question[] = [];

  // 1. emergency. `req.urgency` is never U-X here: decide() strips it.
  // A caller U-1 to U-4 wins over the band, also on a keyword floor hit
  // (Decision 51 as written; Lucas 2026-11-17 (final)).
  const e = signals.emergency;
  const floorHit = e?.status === 'ok' && e.floor_hit === true;
  // The soft card needs a content word; a floor hit or a score at the popup
  // cutoff is exempt (Lucas 2026-11-17).
  const thinSoft =
    band === 'soft' &&
    req.has_content_word === false &&
    !floorHit &&
    !((e?.score ?? 0) >= CUTOFFS.emergency.popup);
  const hasEmergency =
    req.urgency === 'U-0' ||
    ((band === 'popup' || band === 'soft') && !req.urgency && !thinSoft);
  if (req.urgency === 'U-0') {
    out.push(callerU0EmergencyQuestion(tenant));
  } else if (hasEmergency) {
    out.push(bandEmergencyQuestion(tenant, band));
  }

  // 2. time questions
  if (urgency.state === 'ask' && !hasEmergency) {
    const level = signals.urgency?.level;
    if (level === 'U-1') {
      out.push(
        question({
          id: 'urgency_today',
          type: 'confirm_urgency',
          importance: 'high',
          reason: 'urgency_unsure',
          step: 1,
          stem: STEMS.today,
          options: ['U-1', 'U-2', 'U-3'].map(urgencyOption),
          ...urgencyFlags,
        }),
      );
    } else {
      out.push(
        question({
          id: 'urgency_time',
          type: 'confirm_urgency',
          importance: 'low',
          reason: 'urgency_unsure',
          step: 5,
          stem: STEMS.time,
          options: ['U-1', 'U-2', 'U-4', 'U-3'].map(urgencyOption),
          ...urgencyFlags,
        }),
      );
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
    // Stable sort: ties keep vocabulary order.
    const byScore = (a: string, b: string) => sc(b) - sc(a);
    // Every eligible Tier 2 need of the area, best score first. The page
    // shows the top ones and puts the rest under "Show more".
    const topChildren = (t1: string) =>
      childrenOf(t1).filter(eligible).sort(byScore);

    const areaQuestion = (
      t1: string,
      reason: 'area_confirmed' | 'area_only',
      importance: 'high' | 'medium' = 'high',
    ): Question | null => {
      const options = topChildren(t1).map((c) => needOption(c, sc(c), tenant));
      if (options.length < MIN_OPTIONS) return null;
      return question({
        id: `area:${t1}`,
        type: 'find_need',
        importance,
        reason,
        step: 3,
        stem: STEMS.area.replace('{area}', displayOf(t1)),
        options,
        ...needsFlags,
      });
    };

    const level = needLevel(req, signals, matchNone);

    // 3. rule R3: one question per open area (finalize orders them)
    if (level === 'area') {
      for (const t1 of openAreas(req, signals, matchNone)) {
        const q = areaQuestion(
          t1,
          confirmed.includes(t1) ? 'area_confirmed' : 'area_only',
        );
        if (q) out.push(q);
      }
    }
    // Rule C: a likely kind shows results; its area asks 'which kind' quietly (importance medium).
    if (level !== 'unclear') {
      for (const t1 of likelyAreas(req, signals, matchNone)) {
        const q = areaQuestion(t1, 'area_only', 'medium');
        if (q) out.push(q);
      }
    }

    // 4. rule R4: no clear area. The areas in play decide the question; the
    // start question is the fallback (and rule R5's only question).
    if (level === 'unclear') {
      const inPlay = areasInPlayForSpread(req, signals);
      if (inPlay.length >= 2) {
        const word = req.query ?? req.content_words?.join(' ') ?? '';
        out.push(
          question({
            id: 'spread',
            type: 'find_need',
            importance: 'high',
            reason: 'several_areas',
            step: 2,
            stem: STEMS.spread.replace('{word}', () => word),
            options: inPlay.map((c) => needOption(c, sc(c), tenant)),
            ...needsFlags,
          }),
        );
      } else if (inPlay.length === 1) {
        const q = areaQuestion(inPlay[0], 'area_only');
        if (q) out.push(q);
      }

      // 5. start
      const eligibleT1 = TIER1_CODES.filter(eligible).sort(byScore);
      // Every eligible Tier 1 need (Lucas 2026-11-19), best score first.
      // When the model cannot rank, the global default areas come first,
      // then the rest in vocabulary order.
      let picks: string[];
      if (
        eligibleT1.length > 0 &&
        sc(eligibleT1[0]) >= CUTOFFS.start.modelAreasMin
      ) {
        picks = eligibleT1;
      } else {
        const top = fallbackAreas(eligible);
        picks = [
          ...top,
          ...TIER1_CODES.filter((c) => eligible(c) && !top.includes(c)),
        ];
      }
      const options = picks.map((c) => needOption(c, sc(c), tenant));
      if (options.length >= MIN_OPTIONS)
        out.push(
          question({
            id: 'start',
            type: 'find_need',
            importance: 'high',
            reason: 'no_need',
            step: 2,
            stem: STEMS.start,
            options,
            ...needsFlags,
          }),
        );
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
    if (!asksNeeds(q)) continue;
    for (const o of needOptions(q.options)) {
      if (isKnownCode(o.value)) set.add(o.value);
    }
  }
  return [...set].sort(cmp);
}
