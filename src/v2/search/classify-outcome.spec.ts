import { ConfigService } from '@nestjs/config';
import { MlBrokerHttpService } from 'src/ml-broker/ml-broker-http.service';
import {
  MlBrokerError,
  MlBrokerErrorKind,
} from 'src/ml-broker/ml-broker.errors';
import { emergencyBand } from '../rules/bands';
import {
  classifyOutcomeOf,
  ClassifyOutcome,
  failedClassifyResult,
  failureKindOf,
} from './classify-outcome';
import { SearchClassificationClient } from './search-classification.client';
import { toRulesSignals } from './to-rules-signals';

const body = (over: Record<string, unknown> = {}) =>
  ({
    needs: { scores: [{ code: 'N-HOU', tier: 'tier1', score: 0.9 }] },
    urgency: { level: 'U-2', score: 0.95 },
    emergency: {
      status: 'ok',
      score: 0.1,
      floor_hit: false,
      calm_context: null,
      dv_shelter: null,
    },
    ...over,
  }) as never;

const logged = (warn: jest.SpyInstance) =>
  warn.mock.calls.map((c) => String(c[0])).join(' ');

describe('classify outcomes', () => {
  describe('thrown errors map to failed', () => {
    const kinds: MlBrokerErrorKind[] = [
      'unconfigured',
      'timeout',
      'http',
      'network',
      'malformed',
    ];
    const cases: [string, unknown, string][] = [
      ...kinds.map((k): [string, unknown, string] => [
        k,
        new MlBrokerError(k, 'search-classification', 'boom'),
        k,
      ]),
      ['TypeError', new TypeError('secret query text'), 'unexpected'],
    ];

    it.each(cases)('%s', async (_name, error, kind) => {
      expect(failureKindOf(error)).toBe(kind);
      const mlBroker = {
        classifySearch: jest.fn().mockRejectedValue(error),
      } as unknown as MlBrokerHttpService;
      const client = new SearchClassificationClient(
        mlBroker,
        {
          get: jest.fn(),
        } as unknown as ConfigService,
        {
          getOrSet: (_k: string, f: () => Promise<unknown>) => f(),
          setMany: jest.fn(),
        } as never,
      );
      const warn = jest
        .spyOn(
          (client as unknown as { logger: { warn: (m: string) => void } })
            .logger,
          'warn',
        )
        .mockImplementation();

      const result = await client.classify('secret query text', 't1');

      expect(result).toEqual(failedClassifyResult());
      expect(classifyOutcomeOf(result.signals)).toBe('failed');
      expect(logged(warn)).toContain(
        `search classification failed, outcome=failed kind=${kind}`,
      );
      expect(logged(warn)).not.toContain('secret query text');
    });
  });

  describe('bodies map to an outcome and an emergency band', () => {
    const cases: [string, unknown, ClassifyOutcome, string][] = [
      ['ok', body(), 'ok', 'none'],
      [
        'needs_failed',
        body({ needs: { status: 'error', scores: [] }, urgency: null }),
        'needs_failed',
        'none',
      ],
      [
        'needs_failed with a floor hit',
        body({
          needs: { status: 'error', scores: [] },
          urgency: null,
          emergency: {
            status: 'ok',
            score: 0.5,
            floor_hit: true,
            calm_context: null,
            dv_shelter: null,
          },
        }),
        'needs_failed',
        'soft',
      ],
      [
        'emergency missing',
        body({ emergency: undefined }),
        'emergency_failed',
        'unknown',
      ],
      [
        'emergency unknown status',
        body({ emergency: { status: 'weird', score: 0.9 } }),
        'emergency_failed',
        'unknown',
      ],
      [
        'emergency error status',
        body({
          emergency: {
            status: 'error',
            score: null,
            floor_hit: null,
            calm_context: null,
            dv_shelter: null,
          },
        }),
        'emergency_failed',
        'unknown',
      ],
    ];

    it.each(cases)('%s', (_name, input, outcome, band) => {
      const { signals } = toRulesSignals(input as never);
      expect(classifyOutcomeOf(signals)).toBe(outcome);
      expect(emergencyBand(signals.emergency ?? null)).toBe(band);
    });

    it('failed has band unknown', () => {
      const { signals } = failedClassifyResult();
      expect(classifyOutcomeOf(signals)).toBe('failed');
      expect(emergencyBand(signals.emergency ?? null)).toBe('unknown');
    });

    it('a non-finite emergency score is still ok by status, band unknown', () => {
      const { signals } = toRulesSignals(
        body({
          emergency: {
            status: 'ok',
            score: Number.NaN,
            floor_hit: null,
            calm_context: null,
            dv_shelter: null,
          },
        }),
      );
      expect(classifyOutcomeOf(signals)).toBe('ok');
      expect(emergencyBand(signals.emergency ?? null)).toBe('unknown');
    });
  });

  describe('client logs a partial result', () => {
    it.each([
      [
        'needs_failed',
        body({ needs: { status: 'error', scores: [] }, urgency: null }),
      ],
      ['emergency_failed', body({ emergency: undefined })],
    ])('%s', async (outcome, input) => {
      const mlBroker = {
        classifySearch: jest.fn().mockResolvedValue(input),
      } as unknown as MlBrokerHttpService;
      const client = new SearchClassificationClient(
        mlBroker,
        {
          get: jest.fn(),
        } as unknown as ConfigService,
        {
          getOrSet: (_k: string, f: () => Promise<unknown>) => f(),
          setMany: jest.fn(),
        } as never,
      );
      const warn = jest
        .spyOn(
          (client as unknown as { logger: { warn: (m: string) => void } })
            .logger,
          'warn',
        )
        .mockImplementation();
      await client.classify('secret query text', 't1');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(logged(warn)).toBe(
        `search classification partial, outcome=${outcome}`,
      );
    });

    it('does not warn when ok', async () => {
      const mlBroker = {
        classifySearch: jest.fn().mockResolvedValue(body()),
      } as unknown as MlBrokerHttpService;
      const client = new SearchClassificationClient(
        mlBroker,
        {
          get: jest.fn(),
        } as unknown as ConfigService,
        {
          getOrSet: (_k: string, f: () => Promise<unknown>) => f(),
          setMany: jest.fn(),
        } as never,
      );
      const warn = jest
        .spyOn(
          (client as unknown as { logger: { warn: (m: string) => void } })
            .logger,
          'warn',
        )
        .mockImplementation();
      await client.classify('q', 't1');
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
