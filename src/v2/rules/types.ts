import type { Match } from './match';

export type UrgencyCode = 'U-0' | 'U-1' | 'U-2' | 'U-3' | 'U-4' | 'U-X';
export type ModelUrgencyLevel = 'U-1' | 'U-2' | 'U-3' | 'U-4';

export interface RulesRequest {
  has_text: boolean; // query non-empty after trim
  needs: string[]; // confirmed, URL order
  passed_needs: string[];
  urgency?: UrgencyCode; // from the URL; U-X means "time not known" (same as none)
  /**
   * The query text has a content word: 2+ letters, not a function word. The
   * soft emergency card needs one (a floor hit or a score at the popup cutoff
   * is exempt). Absent means true.
   */
  has_content_word?: boolean;
  clarify: 'auto' | 'never';
  /** Normalized model text of the query (the `{word}` of the spread stem). */
  query?: string;
  /** `contentWords(text, lang)` of the query: the words left after function words. */
  content_words?: string[];
}
export interface NeedsSignal {
  status: 'ok' | 'error';
  scores?: Record<string, number>;
}
export interface EmergencySignal {
  status: 'ok' | 'error';
  score?: number;
  floor_hit?: boolean;
  calm_context?: boolean;
  dv_shelter?: boolean;
}
export interface RulesSignals {
  needs: NeedsSignal; // ml-broker needs; status 'error' also covers a timeout
  urgency?: { level: ModelUrgencyLevel; score: number }; // ml-broker urgency, top level as ml-broker sends it; read only when needs.status is 'ok'
  emergency: EmergencySignal | null; // null = no typed text, the check did not run
}
export interface Hotline {
  label: string;
  number: string;
}
/**
 * A tenant's "AI classification" setting (ADR 0039 Decision 52; Lucas
 * 2026-11-13, question 14). `off`: no need guess, no model urgency and no
 * optional question; the emergency check always runs. Absent means `on`.
 */
export type AiClassificationSetting = 'on' | 'off';

export interface TenantContext {
  tenant_id?: string; // for the need text resolver (ISS-2665 seam)
  locale?: string; // for the need text resolver
  hotlines?: Hotline[];
  ai_classification?: AiClassificationSetting;
}

export type EmergencyBand = 'popup' | 'soft' | 'none' | 'unknown';
export type NeedSource = 'caller' | 'inferred';
export interface NeedState {
  code: string;
  state: 'use' | 'ask';
  source: NeedSource;
  confidence?: number; // only for inferred
}
export interface UrgencyState {
  value: UrgencyCode;
  source: 'caller' | 'inferred' | 'default';
  state: 'use' | 'ask' | 'drop';
}

export type QuestionType = 'emergency' | 'confirm_urgency' | 'find_need';
export type QuestionImportance = 'critical' | 'high' | 'medium' | 'low';
export type QuestionReason =
  | 'emergency_band'
  | 'urgency_unsure'
  | 'no_need'
  | 'area_only'
  | 'area_confirmed'
  | 'weak_match'
  | 'several_areas';
/** The URL parameter that a pick of an option adds (ADR 0039 Decision 55). */
export type OptionParameter = 'needs' | 'passed_needs' | 'urgency';
export interface QuestionOption {
  label: string;
  /** Spoken description of the need (ADR 0039 Decision 31); need options only. */
  description?: string;
  /** null with value null: the option writes nothing to the URL (no option does today). */
  parameter: OptionParameter | null;
  value: string | null;
  /** Services that match the option; null = the server did not count (Decision 2026-11-13: null means not counted). Finalize sets it on every option. */
  results_count?: number | null;
  /** Need options only: classifier confidence of the need (0..1). The build sets it; finalize adds 0.3 * log(1+count)/log(1+max count of the question) (null or 0 count adds 0) and sorts high to low. */
  score?: number;
}
export interface Question {
  id: string;
  type: QuestionType;
  importance: QuestionImportance;
  value: number; // within-band importance in [0, 0.999]: model uncertainty x answer effort x result split (rules engine)
  priority: number; // BAND_BASE[importance] + value; questions are ranked by this, high first
  uncertainty: number; // raw model uncertainty in [0, 1] before effort and split
  reason: QuestionReason;
  step: number;
  stem: string;
  options: QuestionOption[];
  multi_select: boolean;
  allow_other: boolean;
  none_of_these: boolean;
  hotlines?: Hotline[]; // emergency question only
}
/**
 * `unclear`: no clear area. `area`: a clear area without a clear kind. `kind`: every clear area has a clear kind.
 * `likely`: every clear area has a clear kind and at least one kind is only likely (`likely_kind`).
 */
export type NeedLevel = 'unclear' | 'area' | 'likely' | 'kind';
/** The grid rule finalize applies (rules-signals-2026-11-23.md). */
export type GridRule = 'no_results' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
export interface Decision {
  rules_version: string;
  /**
   * Model score of every need code offered as an option (never N-X), kept so
   * finalize can recompute a question's uncertainty after it drops 0-count
   * options. Internal: not part of the response.
   */
  option_scores: Record<string, number>;
  /**
   * Band of the emergency check. Internal: not part of the response. The
   * response shows the emergency only as the emergency question (ADR 0039
   * Decision 54).
   */
  emergency_band: EmergencyBand;
  /** A shared cache may store the response (ADR 0039 Decision 28). */
  cacheable: boolean;
  needs: NeedState[]; // use + ask only; drops omitted
  boost_needs: string[];
  nx: boolean;
  urgency: UrgencyState;
  /** How far the need is known (the grid's first measure). Internal: not part of the response. */
  need_level: NeedLevel;
  /**
   * Tier 1 areas that are clear but not kind clear, most likely first
   * (rule R3 asks one question for each). Internal: not part of the response.
   */
  open_areas: string[];
  /**
   * Tier 1 areas whose kind is only likely (a Tier 2 score from kindClearMin
   * below `use`): results show, the area asks a quiet 'medium' question.
   * Internal: not part of the response.
   */
  likely_areas: string[];
  /**
   * The same fields when the hits do not hold the query words (match 'none',
   * D1): finalize swaps them in. Absent when match 'none' changes nothing.
   * Internal: not part of the response.
   */
  if_match_none?: {
    need_level: NeedLevel;
    open_areas: string[];
    likely_areas: string[];
    candidates: Question[];
  };
  /**
   * Tier 1 codes with a model score of 0.05 or more that the caller has not
   * confirmed or passed, best score first. [] when the needs signal failed.
   * Internal: not part of the response.
   */
  areas_in_play: string[];
  candidates: Question[]; // unranked, before counts
  count_codes: string[]; // every need code that is an option in a needs candidate; sorted, unique; never N-X
}
export interface SearchCounts {
  /** `null`: the total was not counted (unreadable `hits.total`). Needs questions are kept. */
  total: number | null;
  /**
   * Results per need code, from the search's count over `sune_needs`.
   * - An object: the codes were counted. A code missing from it has 0 results
   *   (an Elasticsearch terms aggregation leaves out zero-count buckets).
   * - `null`: the codes were not counted (not built yet, `clarify=never`, or
   *   the count failed). Every option is kept, without a count.
   */
  by_code: Record<string, number> | null;
}
export interface FinalizeInput {
  counts: SearchCounts;
  strong_text_match: boolean;
  /** What the returned hits say about the query (match.ts). Absent = 'spread'. */
  match?: Match;
  /** The text found no good match (the service's weak-match flag). */
  weak?: boolean;
}
export interface Clarification {
  rules_version: string;
  questions: Question[];
  /** Rule R5 only: the results may not match the query. */
  notice?: { kind: 'may_not_match'; text: string };
  /** No results and rule R5: a number to call. */
  phone_line?: Hotline;
}
