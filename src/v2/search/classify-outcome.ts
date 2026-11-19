import {
  MlBrokerError,
  MlBrokerErrorKind,
} from 'src/ml-broker/ml-broker.errors';
import { RulesSignals } from '../rules/types';
import type { ClassifyResult } from './to-rules-signals';

/**
 * The one place that names how an ml-broker `search-classification` call can
 * fail, and what `/v2/search` does for each state. The pieces live in other
 * files: `MlBrokerError` kinds (ml-broker.errors.ts), the catch in
 * SearchClassificationClient, the partial states in `toRulesSignals`, and the
 * bands and `cacheable` in the rules engine (rules/bands.ts, rules/engine.ts).
 * Search results return in every state.
 *
 * | State              | Cause                                      | Needs                               | Emergency band                   | Cacheable |
 * | ------------------ | ------------------------------------------ | ----------------------------------- | -------------------------------- | --------- |
 * | `ok`               | needs ok, emergency ok                     | normal                              | from the signal, as normal       | yes, when band is `none` and the answer holds no emergency question |
 * | `needs_failed`     | body `needs.status` is `error`             | no scores, no urgency (U-X drop), no need questions from the model | from the emergency signal, as normal (a keyword floor still gives the soft card, ADR 0037 item 3) | no (engine needs `needs.status` ok) |
 * | `emergency_failed` | body emergency missing, unknown status, or `status` error; a score that is not finite gives the same band | normal | `unknown` | no (engine needs band `none`) |
 * | `failed`           | any thrown error: every `MlBrokerErrorKind` (`unconfigured`, `timeout`, `http`, `network`, `malformed`), or `unexpected` for a non-MlBrokerError | both signals `error` | `unknown` | no |
 */
export type ClassifyOutcome =
  'ok' | 'needs_failed' | 'emergency_failed' | 'failed';

/** The kind logged for a thrown error: an ml-broker kind, or `unexpected`. */
export type ClassifyFailureKind = MlBrokerErrorKind | 'unexpected';

/** The result for a thrown error: both signals `error`, no scores, no model version. */
export const failedClassifyResult = (): ClassifyResult => ({
  signals: { needs: { status: 'error' }, emergency: { status: 'error' } },
  scores: {},
  modelVersion: null,
});

export function failureKindOf(error: unknown): ClassifyFailureKind {
  return error instanceof MlBrokerError ? error.kind : 'unexpected';
}

/**
 * The state of a result, read from signal statuses only. A non-finite
 * emergency score is not checked here: `emergencyBand` maps it to `unknown`.
 */
export function classifyOutcomeOf(signals: RulesSignals): ClassifyOutcome {
  const needsFailed = signals.needs.status === 'error';
  const emergencyFailed = signals.emergency?.status === 'error';
  if (needsFailed && emergencyFailed) return 'failed';
  if (needsFailed) return 'needs_failed';
  if (emergencyFailed) return 'emergency_failed';
  return 'ok';
}
