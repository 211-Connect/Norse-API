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
 * option `score` inside; the response carries `placement` instead.
 *
 * This file only maps. Which questions are asked is the engine's job
 * (`buildCandidates`, `finalize`). Every object is built from an allow list, so
 * a new engine field never reaches the response by itself.
 */
export const CONTRACT_TYPES = ['emergency', 'urgency', 'need'] as const;
export const PLACEMENTS = ['popup', 'before_results', 'with_results'] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];
export type Placement = (typeof PLACEMENTS)[number];

export type ContractOption = Omit<QuestionOption, 'score'>;
export interface ContractQuestion {
  id: string;
  type: ContractType;
  placement: Placement;
  stem: string;
  options: ContractOption[];
  multi_select: boolean;
  allow_other: boolean;
  none_of_these: boolean;
  hotlines?: Hotline[];
}
export interface ContractClarification {
  rules_version: string;
  questions: ContractQuestion[];
  notice?: Clarification['notice'];
  phone_line?: Clarification['phone_line'];
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
export function placementOf(
  q: Pick<Question, 'type' | 'importance'>,
): Placement {
  if (q.type === 'emergency') {
    return q.importance === 'critical' ? 'popup' : 'before_results';
  }
  return q.importance === 'critical' || q.importance === 'high'
    ? 'before_results'
    : 'with_results';
}

const toContractOption = (o: QuestionOption): ContractOption => ({
  label: o.label,
  ...(o.description !== undefined && { description: o.description }),
  parameter: o.parameter,
  value: o.value,
  results_count: o.results_count ?? null,
});

const toContractQuestion = (q: Question): ContractQuestion => ({
  id: q.id,
  type: TYPE_OF[q.type],
  placement: placementOf(q),
  stem: q.stem,
  options: q.options.map(toContractOption),
  multi_select: q.multi_select,
  allow_other: q.allow_other,
  none_of_these: q.none_of_these,
  ...(q.hotlines && { hotlines: q.hotlines }),
});

/** The response shape of a finalized, localized clarification. Pure. */
export function toContractClarification(
  c: Clarification,
): ContractClarification {
  return {
    rules_version: c.rules_version,
    questions: c.questions.map(toContractQuestion),
    ...(c.notice && { notice: c.notice }),
    ...(c.phone_line && { phone_line: c.phone_line }),
  };
}
