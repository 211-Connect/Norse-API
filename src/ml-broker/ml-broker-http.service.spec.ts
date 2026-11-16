import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createMetricsServiceMock } from 'src/metrics/testing/metrics-service.mock';
import { MetricsService } from 'src/metrics/metrics.service';
import { MlBrokerHttpService } from './ml-broker-http.service';
import { MlBrokerError, MlBrokerErrorKind } from './ml-broker.errors';
import { MlBrokerModule } from './ml-broker.module';

const wireBody = (over: Record<string, unknown> = {}) => ({
  task: 'search-classification',
  model_version: 'mv-1',
  components: {},
  query: 'rent help',
  tenant_id: 't1',
  needs: { scores: [{ code: 'N-HOU', tier: 'tier1', score: 0.9 }] },
  urgency: { level: 'U-2', score: 0.95, probs: {} },
  emergency: {
    status: 'ok',
    score: 0.1,
    floor_hit: false,
    calm_context: null,
    dv_shelter: true,
  },
  ...over,
});

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn(async () => body),
    text: jest.fn(async () => JSON.stringify(body)),
  }) as unknown as Response & { json: jest.Mock; text: jest.Mock };

const fullConfig = {
  ML_BROKER_BASE_URL: 'http://broker.test',
  ML_BROKER_API_KEY: 'secret-key',
};
const request = { query: 'my secret ssn 123', tenant_id: 't1' };

describe('MlBrokerHttpService', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  let metrics: ReturnType<typeof createMetricsServiceMock>;

  const build = (config: Record<string, string | undefined>) =>
    new MlBrokerHttpService(
      {
        get: jest.fn((key: string) => config[key]),
      } as unknown as ConfigService,
      metrics as unknown as MetricsService,
    );

  /** Runs classifySearch and returns the MlBrokerError it must throw. */
  const failure = async (
    service: MlBrokerHttpService,
  ): Promise<MlBrokerError> => {
    const error = await service.classifySearch(request).then(
      () => {
        throw new Error('expected classifySearch to throw');
      },
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(MlBrokerError);
    const e = error as MlBrokerError;
    expect(e.task).toBe('search-classification');
    expect(e.message).not.toContain('ssn');
    expect(e.message).not.toContain('secret-key');
    return e;
  };

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    metrics = createMetricsServiceMock();
  });
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('is provided and exported by MlBrokerModule, and boots with no ml-broker config', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MlBrokerModule],
    })
      .useMocker((token) => {
        if (token === ConfigService) return { get: () => undefined };
        if (token === MetricsService) return metrics;
        return undefined;
      })
      .compile();
    expect(moduleRef.get(MlBrokerHttpService)).toBeInstanceOf(
      MlBrokerHttpService,
    );
  });

  it('posts the request to the search-classification task and returns the wire body', async () => {
    const body = wireBody();
    fetchMock.mockResolvedValue(jsonResponse(body));
    await expect(build(fullConfig).classifySearch(request)).resolves.toEqual(
      body,
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'http://broker.test/api/v1/tasks/search-classification/predict',
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'x-api-key': 'secret-key',
    });
    expect(JSON.parse(init.body)).toEqual(request);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(metrics.observeDownstream).toHaveBeenCalledWith(
      'ml_broker',
      'search_classification',
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('classifies a non-2xx response as error in the downstream metric', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 500));
    await failure(build(fullConfig));
    const classify = (
      metrics.observeDownstream.mock.calls[0] as unknown[]
    )[3] as (res: { ok: boolean }) => string;
    expect(classify({ ok: false })).toBe('error');
    expect(classify({ ok: true })).toBe('ok');
  });

  it.each([
    ['ML_BROKER_API_KEY missing', { ML_BROKER_BASE_URL: 'http://broker.test' }],
    ['ML_BROKER_BASE_URL missing', { ML_BROKER_API_KEY: 'k' }],
    ['both missing', {}],
  ])(
    'throws unconfigured, without calling fetch, when %s',
    async (_label, config) => {
      const e = await failure(build(config));
      expect(e.kind).toBe<MlBrokerErrorKind>('unconfigured');
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('throws http with the status on a non-2xx, without reading the body', async () => {
    const response = jsonResponse({ detail: 'my secret ssn 123' }, 502);
    fetchMock.mockResolvedValue(response);
    const e = await failure(build(fullConfig));
    expect(e.kind).toBe<MlBrokerErrorKind>('http');
    expect(e.status).toBe(502);
    expect(response.json).not.toHaveBeenCalled();
    expect(response.text).not.toHaveBeenCalled();
  });

  it('throws network when fetch rejects', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const e = await failure(build(fullConfig));
    expect(e.kind).toBe<MlBrokerErrorKind>('network');
    expect(e.status).toBeUndefined();
  });

  it('throws malformed when the body is not JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    });
    expect((await failure(build(fullConfig))).kind).toBe<MlBrokerErrorKind>(
      'malformed',
    );
  });

  it.each([
    ['an unrelated object', { unexpected: true }],
    ['null', null],
    ['needs.scores not an array', wireBody({ needs: { scores: {} } })],
    [
      'an unknown urgency level',
      wireBody({ urgency: { level: 'U-9', score: 1 } }),
    ],
    [
      'a non-numeric urgency score',
      wireBody({ urgency: { level: 'U-1', score: '1' } }),
    ],
    ['no urgency', wireBody({ urgency: undefined })],
  ])('throws malformed on %s', async (_label, body) => {
    fetchMock.mockResolvedValue(jsonResponse(body));
    expect((await failure(build(fullConfig))).kind).toBe<MlBrokerErrorKind>(
      'malformed',
    );
  });

  it('accepts a body with no emergency block or model version', async () => {
    const body = wireBody({ emergency: undefined, model_version: undefined });
    fetchMock.mockResolvedValue(jsonResponse(body));
    await expect(build(fullConfig).classifySearch(request)).resolves.toEqual(
      body,
    );
  });

  it('aborts at V2_CLASSIFY_TIMEOUT_MS and throws timeout', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(init.signal.reason),
          );
        }),
    );
    const started = Date.now();
    const e = await failure(
      build({ ...fullConfig, V2_CLASSIFY_TIMEOUT_MS: '25' }),
    );
    expect(e.kind).toBe<MlBrokerErrorKind>('timeout');
    expect(e.message).toContain('25ms');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('throws timeout when the body read is aborted', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new DOMException('timed out', 'TimeoutError');
      },
    });
    expect((await failure(build(fullConfig))).kind).toBe<MlBrokerErrorKind>(
      'timeout',
    );
  });

  it.each([
    ['unset', undefined, 1000],
    ['a positive integer', '250', 250],
    ['zero', '0', 1000],
    ['negative', '-5', 1000],
    ['not a number', 'soon', 1000],
  ])(
    'uses a timeout of %s V2_CLASSIFY_TIMEOUT_MS',
    async (_label, raw, expected) => {
      const timeout = jest.spyOn(AbortSignal, 'timeout');
      fetchMock.mockResolvedValue(jsonResponse(wireBody()));
      await build({
        ...fullConfig,
        V2_CLASSIFY_TIMEOUT_MS: raw,
      }).classifySearch(request);
      expect(timeout).toHaveBeenCalledWith(expected);
    },
  );
});
