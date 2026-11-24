import { matchLocale } from '../../common/locales';
import { STEMS, UI_STRINGS } from './config';
import { blocksResults } from './importance';
import { LOCALE_TABLES } from './locales';
import type {
  Clarification,
  Hotline,
  Question,
  QuestionOption,
  QuestionType,
} from './types';

/**
 * Question contract v2: the response shape of a question. The engine keeps
 * `importance`, `priority`, `value`, `uncertainty`, `reason`, `step` and the
 * option `score` inside; the response carries `placement` and `style` instead.
 *
 * This file only maps. Which questions are asked is the engine's job: no
 * urgency question beside danger or after its answer (buildCandidates), the
 * cap on `before_results` questions and the notice that needs one (finalize),
 * hotlines on the danger question only, gone with it once U-1 to U-4 is set
 * (buildCandidates), and no option that stands for "none". Skip is a UI rule.
 */
export const CONTRACT_TYPES = ['emergency', 'urgency', 'need'] as const;
export const PLACEMENTS = ['popup', 'before_results', 'with_results'] as const;
export const STYLES = ['strong', 'standard', 'subtle'] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];
export type Placement = (typeof PLACEMENTS)[number];
export type Style = (typeof STYLES)[number];

export interface ContractQuestion {
  id: string;
  type: ContractType;
  placement: Placement;
  style: Style;
  stem: string;
  options: Omit<QuestionOption, 'score'>[];
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
export interface ContractClarification extends Omit<
  Clarification,
  'questions'
> {
  questions: ContractQuestion[];
  strings: ContractStrings;
}

const TYPE_OF: Record<QuestionType, ContractType> = {
  emergency: 'emergency',
  confirm_urgency: 'urgency',
  find_need: 'need',
};

/**
 * Importance is the engine's own band: critical = strong danger, high = soft
 * danger and every question that blocks, medium or low = beside the results.
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
  return blocksResults(q)
    ? { placement: 'before_results', style: 'standard' }
    : { placement: 'with_results', style: 'subtle' };
}

/**
 * The words the page shows that no question carries. The popup title is the
 * danger question itself, so it has that question's translations. A missing
 * translation is the English text.
 */
export function localizedStrings(lang: string | undefined): ContractStrings {
  const table = matchLocale(lang, (t) => LOCALE_TABLES[t]);
  return {
    popup_title: table?.stems.emergency?.text ?? STEMS.emergency,
    skip_to_results:
      table?.strings?.skipToResults?.text ?? UI_STRINGS.skipToResults,
    also_fit_one: table?.strings?.alsoFitOne?.text ?? UI_STRINGS.alsoFitOne,
  };
}

const toContractOption = (
  o: QuestionOption,
): Omit<QuestionOption, 'score'> => ({
  label: o.label,
  ...(o.description !== undefined && { description: o.description }),
  parameter: o.parameter,
  value: o.value,
  results_count: o.results_count ?? null,
});

const toContractQuestion = (q: Question): ContractQuestion => ({
  id: q.id,
  type: TYPE_OF[q.type],
  ...placementAndStyle(q),
  stem: q.stem,
  options: q.options.map(toContractOption),
  multi_select: q.multi_select,
  allow_other: q.allow_other,
  none_of_these: q.none_of_these,
  ...(q.hotlines && { hotlines: q.hotlines }),
});

/** The response shape of a finalized, localized clarification. Pure. */
export function toContractClarification(
  clarification: Clarification,
  lang: string | undefined,
): ContractClarification {
  return {
    ...clarification,
    questions: clarification.questions.map(toContractQuestion),
    strings: localizedStrings(lang),
  };
}
