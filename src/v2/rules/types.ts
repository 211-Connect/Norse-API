export type UrgencyCode = 'U-0' | 'U-1' | 'U-2' | 'U-3' | 'U-4' | 'U-X';
export type ModelUrgencyLevel = 'U-1' | 'U-2' | 'U-3' | 'U-4';

export interface RulesRequest {
  has_text: boolean; // query non-empty after trim
  needs: string[]; // confirmed, URL order
  passed_needs: string[];
  urgency?: UrgencyCode; // from the URL
  clarify: 'auto' | 'never';
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
  top_areas?: string[]; // Tier 1 codes by service count, desc
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

export type QuestionType =
  'emergency' | 'confirm_urgency' | 'find_need' | 'narrow';
export type QuestionImportance = 'critical' | 'high' | 'medium' | 'low';
export type QuestionReason =
  | 'emergency_band'
  | 'urgency_unsure'
  | 'no_need'
  | 'area_only'
  | 'area_confirmed'
  | 'unsure_needs';
/** The URL parameter that a pick of an option adds (ADR 0039 Decision 55). */
export type OptionParameter = 'needs' | 'passed_needs' | 'urgency';
export interface QuestionOption {
  label: string;
  /** null with value null: the option writes nothing to the URL (emergency "safe"; the client dismisses the question for this visit). */
  parameter: OptionParameter | null;
  value: string | null;
  /** Services that match the option; null = the server did not count (Decision 2026-11-13: null means not counted). Finalize sets it on every option. */
  results_count?: number | null;
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
  candidates: Question[]; // unranked, before counts
  count_codes: string[]; // every need code that is an option in a needs candidate; sorted, unique; never N-X
}
export interface SearchCounts {
  total: number;
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
}
export interface Clarification {
  rules_version: string;
  questions: Question[];
}
