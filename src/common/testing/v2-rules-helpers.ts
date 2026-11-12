import { RulesRequest, RulesSignals } from '../../v2/rules/types';

export const req = (o: Partial<RulesRequest> = {}): RulesRequest => ({
  has_text: true,
  needs: [],
  passed_needs: [],
  clarify: 'auto',
  ...o,
});

export const sig = (
  scores: Record<string, number> = {},
  o: Partial<RulesSignals> = {},
): RulesSignals => ({
  needs: { status: 'ok', scores },
  emergency: { status: 'ok', score: 0.001, floor_hit: false },
  ...o,
});
