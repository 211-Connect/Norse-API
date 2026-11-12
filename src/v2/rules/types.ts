export type UrgencyCode = 'U-0' | 'U-1' | 'U-2' | 'U-3' | 'U-4' | 'U-X';
export type ModelUrgencyLevel = 'U-1' | 'U-2' | 'U-3' | 'U-4';

export interface RulesRequest {
  hasText: boolean; // query non-empty after trim
  needs: string[]; // confirmed, URL order
  passedNeeds: string[];
  urgency?: UrgencyCode; // from the URL
  clarify: 'auto' | 'never';
}
export interface NeedsSignal {
  status: 'ok' | 'error';
  scores?: Record<string, number>;
  urgency?: { level: ModelUrgencyLevel; score: number };
}
export interface EmergencySignal {
  status: 'ok' | 'error';
  score?: number;
  floorHit?: boolean;
  calmContext?: boolean;
  dvShelter?: boolean;
}
export interface RulesSignals {
  needs: NeedsSignal; // ml-broker needs + urgency; status 'error' also covers a timeout
  emergency: EmergencySignal | null; // null = no typed text, the check did not run
}
export interface Hotline {
  label: string;
  number: string;
}
export interface TenantContext {
  topAreas?: string[]; // Tier 1 codes by service count, desc
  hotlines?: Hotline[];
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
export type QuestionLevel = 'red' | 'orange' | 'low';
export type QuestionImportance = 'critical' | 'high' | 'medium' | 'low';
export type QuestionReason =
  | 'emergency_band'
  | 'urgency_unsure'
  | 'no_need'
  | 'area_only'
  | 'area_confirmed'
  | 'unsure_needs';
export interface QuestionOption {
  value: string;
  label: string;
  resultsCount?: number;
}
export interface Question {
  id: string;
  type: QuestionType;
  level: QuestionLevel;
  importance: QuestionImportance;
  value: number; // within-band importance in [0, 0.999]: model uncertainty x answer effort x result split (rules engine)
  priority: number; // BAND_BASE[importance] + value; questions are ranked by this, high first
  uncertainty: number; // raw model uncertainty in [0, 1] before effort and split
  reason: QuestionReason;
  step: number;
  parameter: 'urgency' | 'needs';
  stem: string;
  options: QuestionOption[];
  multiSelect: boolean;
  allowOther: boolean;
  noneOfThese: boolean;
  hotlines?: Hotline[]; // emergency question only
}
export interface Decision {
  rulesVersion: string;
  /**
   * Model score of every need code offered as an option (never N-X), kept so
   * finalize can recompute a question's uncertainty after it drops 0-count
   * options. Internal: not part of the response.
   */
  optionScores: Record<string, number>;
  emergency: { band: EmergencyBand; showHotline: boolean };
  cacheable: boolean;
  needs: NeedState[]; // use + ask only; drops omitted
  boostNeeds: string[];
  nx: boolean;
  urgency: UrgencyState;
  candidates: Question[]; // unranked, before counts
  countCodes: string[]; // every need code that is an option in a needs candidate; sorted, unique; never N-X
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
  byCode: Record<string, number> | null;
}
export interface FinalizeInput {
  counts: SearchCounts;
  strongTextMatch: boolean;
}
export interface Clarification {
  rulesVersion: string;
  questions: Question[];
}
