import { SearchClassificationResponse } from 'src/ml-broker/ml-broker-http.service';
import { toRulesSignals } from './to-rules-signals';

const body = (
  over: Partial<SearchClassificationResponse> = {},
): SearchClassificationResponse => ({
  model_version: 'mv-1',
  needs: {
    scores: [
      { code: 'N-HOU-02', tier: 'tier2', score: 0.98 },
      { code: 'N-HOU', tier: 'tier1', score: 0.9 },
      { code: 'N-X', tier: 'nx', score: 0.01 },
    ],
  },
  urgency: { level: 'U-2', score: 0.95 },
  emergency: {
    status: 'ok',
    score: 0.1,
    floor_hit: false,
    calm_context: null,
    dv_shelter: true,
  },
  ...over,
});

describe('toRulesSignals', () => {
  it('maps the score list to a map, null to undefined, urgency at the top level', () => {
    expect(toRulesSignals(body())).toEqual({
      modelVersion: 'mv-1',
      scores: { 'N-HOU-02': 0.98, 'N-HOU': 0.9, 'N-X': 0.01 },
      signals: {
        needs: {
          status: 'ok',
          scores: { 'N-HOU-02': 0.98, 'N-HOU': 0.9, 'N-X': 0.01 },
        },
        urgency: { level: 'U-2', score: 0.95 },
        emergency: {
          status: 'ok',
          score: 0.1,
          floor_hit: false,
          calm_context: undefined,
          dv_shelter: true,
        },
      },
    });
  });

  it('carries true booleans through unchanged', () => {
    const { signals } = toRulesSignals(
      body({
        emergency: {
          status: 'ok',
          score: 0.99,
          floor_hit: true,
          calm_context: true,
          dv_shelter: false,
        },
      }),
    );
    expect(signals.emergency).toEqual({
      status: 'ok',
      score: 0.99,
      floor_hit: true,
      calm_context: true,
      dv_shelter: false,
    });
  });

  it('passes an emergency status error through with needs ok', () => {
    const result = toRulesSignals(
      body({
        emergency: {
          status: 'error',
          score: null,
          floor_hit: null,
          calm_context: null,
          dv_shelter: null,
        },
      }),
    );
    expect(result.signals.needs.status).toBe('ok');
    expect(result.signals.emergency).toEqual({
      status: 'error',
      score: undefined,
      floor_hit: undefined,
      calm_context: undefined,
      dv_shelter: undefined,
    });
    expect(result.modelVersion).toBe('mv-1');
  });

  it('maps a missing emergency block to status error', () => {
    expect(
      toRulesSignals(body({ emergency: undefined })).signals.emergency,
    ).toEqual({ status: 'error' });
  });

  it('maps an unknown emergency status to status error', () => {
    const emergency = {
      ...body().emergency,
      status: 'maybe',
    } as unknown as SearchClassificationResponse['emergency'];
    expect(toRulesSignals(body({ emergency })).signals.emergency).toEqual({
      status: 'error',
    });
  });

  it('reports a null model version when it is missing or not a string', () => {
    expect(
      toRulesSignals(body({ model_version: undefined })).modelVersion,
    ).toBeNull();
    expect(
      toRulesSignals(body({ model_version: 7 as unknown as string }))
        .modelVersion,
    ).toBeNull();
  });

  it('maps an empty score list to empty scores', () => {
    const result = toRulesSignals(body({ needs: { scores: [] } }));
    expect(result.scores).toEqual({});
    expect(result.signals.needs.scores).toEqual({});
  });
});
