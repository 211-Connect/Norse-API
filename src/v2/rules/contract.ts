import { matchLocale } from '../../common/locales';
import { UI_STRINGS } from './config';
import { LOCALE_TABLES } from './locales';
import type { UiStringKey } from './locales';
import type {
  Clarification,
  Hotline,
  Question,
  QuestionOption,
  QuestionType,
  UrgencyCode,
} from './types';

/**
 * Question contract v2 (HANDOFF-ASSETS/v2-search--rules-engine/question-contract-v2.md).
 * The engine keeps `importance`, `priority`, `value`, `uncertainty`, `reason`,
 * `step` and option `score` inside; the response carries `placement` and
 * `style` instead. Pure: the input is not changed.
 */
export type Placement = 'popup' | 'before_results' | 'with_results';
export type Style = 'strong' | 'standard' | 'subtle';
export type ContractType = 'emergency' | 'urgency' | 'need';

export interface ContractOption {
  label: string;
  description?: string;
  parameter: QuestionOption['parameter'];
  value: string | null;
  results_count: number | null;
}
export interface ContractQuestion {
  id: string;
  type: ContractType;
  placement: Placement;
  style: Style;
  stem: string;
  options: ContractOption[];
  multi_select: boolean;
  allow_other: boolean;
  none_of_these: boolean;
  hotlines?: Hotline[];
}
export interface ContractStrings {
  popup_title: string;
  skip_to_results: string;
  also_fit_one: string;
}
export interface ContractClarification {
  rules_version: string;
  questions: ContractQuestion[];
  strings: ContractStrings;
  notice?: Clarification['notice'];
  phone_line?: Clarification['phone_line'];
}

/** Rule 2: at most this many `before_results` questions per search session. */
export const MAX_BEFORE_RESULTS = 3;

const TYPE_OF: Record<QuestionType, ContractType> = {
  emergency: 'emergency',
  confirm_urgency: 'urgency',
  find_need: 'need',
};

/**
 * The mapping table of the spec (rules engine). Importance is the engine's
 * own band: critical = strong danger (popup), high = soft danger and every
 * blocking question, medium or low = the questions that sit beside results.
 *  - emergency, critical: popup, strong
 *  - emergency, high (soft band): before_results, strong
 *  - need (start, spread, least-certain area), no_match, urgency_today: before_results, standard
 *  - need (other open areas in R3, likely kind), urgency_time: with_results, subtle
 */
export function placementAndStyle(q: Pick<Question, 'type' | 'importance'>): {
  placement: Placement;
  style: Style;
} {
  if (q.type === 'emergency') {
    return q.importance === 'critical'
      ? { placement: 'popup', style: 'strong' }
      : { placement: 'before_results', style: 'strong' };
  }
  return q.importance === 'critical' || q.importance === 'high'
    ? { placement: 'before_results', style: 'standard' }
    : { placement: 'with_results', style: 'subtle' };
}

/** Rule 3: only the `none_of_these` flag; never an option that stands for "none". */
const FAKE_NONE = /^(none|none_of_these|no_match)$/i;

const SAFE_ANSWERS: ReadonlySet<UrgencyCode> = new Set<UrgencyCode>([
  'U-1',
  'U-2',
  'U-3',
  'U-4',
]);

export interface ContractInput {
  /** The request's `urgency` (U-X counts as absent). */
  urgency?: UrgencyCode;
  /** The `asked=` question ids of the search session. */
  asked?: readonly string[];
  lang?: string;
}

/** Rule 5: popup title, "Skip to results", "Does this also fit?" in the request language. */
export function localizedStrings(lang: string | undefined): ContractStrings {
  const table = matchLocale(lang, (t) => LOCALE_TABLES[t]);
  const pick = (key: UiStringKey): string =>
    table?.strings?.[key]?.text ?? UI_STRINGS[key];
  return {
    popup_title: pick('popupTitle'),
    skip_to_results: pick('skipToResults'),
    also_fit_one: pick('alsoFitOne'),
  };
}

function toContractQuestion(
  q: Question,
  input: ContractInput,
): ContractQuestion {
  const { placement, style } = placementAndStyle(q);
  const type = TYPE_OF[q.type];
  const hideHotlines =
    input.urgency !== undefined && SAFE_ANSWERS.has(input.urgency);
  return {
    id: q.id,
    type,
    placement,
    style,
    stem: q.stem,
    options: q.options
      .filter((o) => !(o.value !== null && FAKE_NONE.test(o.value)))
      .map((o) => ({
        label: o.label,
        ...(o.description !== undefined && { description: o.description }),
        parameter: o.parameter,
        value: o.value,
        results_count: o.results_count ?? null,
      })),
    multi_select: q.multi_select,
    allow_other: q.allow_other,
    none_of_these: q.none_of_these,
    // Rule 4: hotlines only on the danger question, and not once a safe answer is in the URL.
    ...(type === 'emergency' &&
      !hideHotlines &&
      q.hotlines &&
      q.hotlines.length > 0 && { hotlines: q.hotlines }),
  };
}

/**
 * Turns the engine's clarification into the response shape of question
 * contract v2 and applies the API-owned rules:
 *  1. no `urgency` question beside the danger question;
 *  2. after `MAX_BEFORE_RESULTS` asked ids, no `before_results` question (the
 *     danger question is a safety path and is never cut);
 *  3. no fake "none" option; 4. hotlines; 5. strings.
 * Rule 6 (skip) stays in the UI.
 */
export function toContractClarification(
  clarification: Clarification,
  input: ContractInput = {},
): ContractClarification {
  const hasEmergency = clarification.questions.some(
    (q) => q.type === 'emergency',
  );
  const askedCount = new Set(input.asked ?? []).size;
  const capReached = askedCount >= MAX_BEFORE_RESULTS;
  const questions = clarification.questions
    .filter((q) => !(hasEmergency && q.type === 'confirm_urgency'))
    .map((q) => toContractQuestion(q, input))
    .filter(
      (q) =>
        !(
          capReached &&
          q.placement === 'before_results' &&
          q.type !== 'emergency'
        ),
    );
  return {
    rules_version: clarification.rules_version,
    questions,
    strings: localizedStrings(input.lang),
    ...(clarification.notice && { notice: clarification.notice }),
    ...(clarification.phone_line && { phone_line: clarification.phone_line }),
  };
}
