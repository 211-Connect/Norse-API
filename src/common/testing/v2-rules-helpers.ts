import { RulesRequest, RulesSignals } from '../../v2/rules/types';

export const req = (o: Partial<RulesRequest> = {}): RulesRequest => ({
  hasText: true,
  needs: [],
  passedNeeds: [],
  clarify: 'auto',
  ...o,
});

export const sig = (
  scores: Record<string, number> = {},
  o: Partial<RulesSignals> = {},
): RulesSignals => ({
  needs: { status: 'ok', scores },
  emergency: { status: 'ok', score: 0.001, floorHit: false },
  ...o,
});
