import { SearchClassificationResponse } from 'src/ml-broker/ml-broker-http.service';
import { EmergencySignal, RulesSignals } from '../rules/types';

export interface ClassifyResult {
  signals: RulesSignals;
  scores: Record<string, number>;
  modelVersion: string | null;
}

const orUndefined = <T>(value: T | null | undefined): T | undefined =>
  value ?? undefined;

/**
 * Maps an ml-broker `search-classification` body (already shape-checked by
 * MlBrokerHttpService) to rules-engine signals: need scores list to a map,
 * null to undefined. Field names and the top-level urgency already match the engine.
 * An emergency block that is missing or has an unknown status maps to
 * `{ status: 'error' }`.
 */
export function toRulesSignals(
  body: SearchClassificationResponse,
): ClassifyResult {
  const scores: Record<string, number> = {};
  for (const entry of body.needs.scores) scores[entry.code] = entry.score;

  const e = body.emergency;
  const emergency: EmergencySignal =
    e && (e.status === 'ok' || e.status === 'error')
      ? {
          status: e.status,
          score: orUndefined(e.score),
          floor_hit: orUndefined(e.floor_hit),
          calm_context: orUndefined(e.calm_context),
          dv_shelter: orUndefined(e.dv_shelter),
        }
      : { status: 'error' };

  return {
    signals: {
      needs: { status: 'ok', scores },
      // urgency null (emergency_only): no urgency field, as for AI off.
      ...(body.urgency && {
        urgency: { level: body.urgency.level, score: body.urgency.score },
      }),
      emergency,
    },
    scores,
    modelVersion:
      typeof body.model_version === 'string' ? body.model_version : null,
  };
}
