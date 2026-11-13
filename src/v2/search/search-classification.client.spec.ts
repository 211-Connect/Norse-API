import { ConfigService } from '@nestjs/config';
import { createMetricsServiceMock } from 'src/metrics/testing/metrics-service.mock';
import { MetricsService } from 'src/metrics/metrics.service';
import { MlBrokerHttpService } from 'src/ml-broker/ml-broker-http.service';
import { SearchClassificationClient } from './search-classification.client';

const ERROR_RESULT = {
  signals: { needs: { status: 'error' }, emergency: { status: 'error' } },
  scores: {},
  modelVersion: null,
};

const brokerBody = (over: Record<string, unknown> = {}) => ({
  task: 'search-classification',
  model_version: 'mv-1',
  components: {},
  query: 'rent help',
  tenant_id: 't1',
  needs: {
    scores: [
      { code: 'N-HOU-02', tier: 'tier2', score: 0.98 },
      { code: 'N-HOU', tier: 'tier1', score: 0.9 },
      { code: 'N-X', tier: 'nx', score: 0.01 },
    ],
  },
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
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

describe('SearchClassificationClient', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  let metrics: ReturnType<typeof createMetricsServiceMock>;

  const build = (config: Record<string, string | undefined>) => {
    const configService = {
      get: jest.fn((key: string) => config[key]),
    } as unknown as ConfigService;
    return new SearchClassificationClient(
      new MlBrokerHttpService(
        configService,
        metrics as unknown as MetricsService,
      ),
    );
  };
  const fullConfig = {
    ML_BROKER_BASE_URL: 'http://broker.test',
    ML_BROKER_API_KEY: 'secret-key',
  };

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    metrics = createMetricsServiceMock();
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('posts to the search-classification task and maps the response to signals', async () => {
    fetchMock.mockResolvedValue(jsonResponse(brokerBody()));
    const result = await build(fullConfig).classify('rent help', 't1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'http://broker.test/api/v1/tasks/search-classification/predict',
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'x-api-key': 'secret-key',
    });
    expect(JSON.parse(init.body)).toEqual({
      query: 'rent help',
      tenant_id: 't1',
    });
    expect(metrics.observeDownstream).toHaveBeenCalledWith(
      'ml_broker',
      'search_classification',
      expect.any(Function),
      expect.any(Function),
    );

    expect(result).toEqual({
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

  it('passes an emergency status error through with needs ok', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        brokerBody({
          emergency: {
            status: 'error',
            score: null,
            floor_hit: null,
            calm_context: null,
            dv_shelter: null,
          },
        }),
      ),
    );
    const result = await build(fullConfig).classify('rent help', 't1');
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

  it('returns the error result on a non-200', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'boom' }, 500));
    expect(await build(fullConfig).classify('q', 't1')).toEqual(ERROR_RESULT);
  });

  it('returns the error result on a network error', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    expect(await build(fullConfig).classify('q', 't1')).toEqual(ERROR_RESULT);
  });

  it('returns the error result on an unparsable body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ unexpected: true }));
    expect(await build(fullConfig).classify('q', 't1')).toEqual(ERROR_RESULT);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    });
    expect(await build(fullConfig).classify('q', 't1')).toEqual(ERROR_RESULT);
  });

  it('aborts at V2_CLASSIFY_TIMEOUT_MS and returns the error result', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    const started = Date.now();
    const result = await build({
      ...fullConfig,
      V2_CLASSIFY_TIMEOUT_MS: '25',
    }).classify('q', 't1');
    expect(result).toEqual(ERROR_RESULT);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('returns the error result, without calling fetch, when config is missing', async () => {
    expect(
      await build({ ML_BROKER_BASE_URL: 'http://broker.test' }).classify(
        'q',
        't1',
      ),
    ).toEqual(ERROR_RESULT);
    expect(await build({ ML_BROKER_API_KEY: 'k' }).classify('q', 't1')).toEqual(
      ERROR_RESULT,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never logs the query text or the api key', async () => {
    const client = build(fullConfig);
    const warn = jest
      .spyOn(
        (client as unknown as { logger: { warn: (m: string) => void } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    await client.classify('my secret ssn 123', 't1');
    expect(warn).toHaveBeenCalled();
    const logged = warn.mock.calls.map((c) => String(c[0])).join(' ');
    expect(logged).not.toContain('ssn');
    expect(logged).not.toContain('secret-key');
    expect(logged).toContain('kind=network');
  });

  it.each([
    ['unconfigured', () => undefined, {}],
    [
      'http',
      () => fetchMock.mockResolvedValue(jsonResponse({ detail: 'q' }, 503)),
      fullConfig,
    ],
    [
      'malformed',
      () => fetchMock.mockResolvedValue(jsonResponse({ needs: {} })),
      fullConfig,
    ],
  ])(
    'names the failure kind %s in the warning, never the query',
    async (kind, arrange, config) => {
      arrange();
      const client = build(config);
      const warn = jest
        .spyOn(
          (client as unknown as { logger: { warn: (m: string) => void } })
            .logger,
          'warn',
        )
        .mockImplementation(() => undefined);
      expect(await client.classify('my secret ssn 123', 't1')).toEqual(
        ERROR_RESULT,
      );
      const logged = warn.mock.calls.map((c) => String(c[0])).join(' ');
      expect(logged).toContain(`kind=${kind}`);
      expect(logged).not.toContain('ssn');
    },
  );

  it('returns the error result when the transport throws something unexpected', async () => {
    const client = new SearchClassificationClient({
      classifySearch: jest.fn().mockRejectedValue('not an Error'),
    } as unknown as MlBrokerHttpService);
    expect(await client.classify('q', 't1')).toEqual(ERROR_RESULT);
  });

  it('returns the error result when the mapping throws', async () => {
    const client = new SearchClassificationClient({
      classifySearch: jest.fn().mockResolvedValue(null),
    } as unknown as MlBrokerHttpService);
    expect(await client.classify('q', 't1')).toEqual(ERROR_RESULT);
  });
});
