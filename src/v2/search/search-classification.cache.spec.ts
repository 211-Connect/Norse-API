import { ConfigService } from '@nestjs/config';
import { trace } from '@opentelemetry/api';
import { RequestCacheService } from 'src/common/services/cache/request-cache.service';
import { createMetricsServiceMock } from 'src/metrics/testing/metrics-service.mock';
import { MetricsService } from 'src/metrics/metrics.service';
import { MlBrokerHttpService } from 'src/ml-broker/ml-broker-http.service';
import { classifyCacheKey } from './classify-cache-key';
import { SearchClassificationClient } from './search-classification.client';

const brokerBody = (over: Record<string, unknown> = {}) => ({
  task: 'search-classification',
  model_version: 'mv-1',
  components: {},
  query: 'rent help',
  tenant_id: 't1',
  needs: { scores: [{ code: 'N-HOU-02', tier: 'tier2', score: 0.98 }] },
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

const TTL = 24 * 60 * 60 * 1000;

describe('SearchClassificationClient cache', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  let store: Map<string, unknown>;
  let sets: Array<[string, unknown, number | undefined]>;
  let getFails: boolean;

  const build = (extra: Record<string, string> = {}) => {
    const config: Record<string, string> = {
      ML_BROKER_BASE_URL: 'http://broker.test',
      ML_BROKER_API_KEY: 'secret-key',
      ...extra,
    };
    const configService = {
      get: jest.fn((key: string) => config[key]),
    } as unknown as ConfigService;
    const metrics = createMetricsServiceMock();
    const cacheManager = {
      get: jest.fn((k: string) =>
        getFails
          ? Promise.reject(new Error('redis down'))
          : Promise.resolve(store.get(k)),
      ),
      set: jest.fn((k: string, v: unknown, ttl?: number) => {
        sets.push([k, v, ttl]);
        store.set(k, v);
        return Promise.resolve();
      }),
      mset: jest.fn((list: any[]) => {
        list.forEach((e) => {
          sets.push([e.key, e.value, e.ttl]);
          store.set(e.key, e.value);
        });
        return Promise.resolve();
      }),
    };
    return new SearchClassificationClient(
      new MlBrokerHttpService(
        configService,
        metrics as unknown as MetricsService,
      ),
      configService,
      new RequestCacheService(
        cacheManager as any,
        metrics as unknown as MetricsService,
        configService,
      ),
    );
  };

  const errorEmergency = {
    status: 'error',
    score: null,
    floor_hit: null,
    calm_context: null,
    dv_shelter: null,
  };

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    store = new Map();
    sets = [];
    getFails = false;
  });
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('miss then hit: one broker call, the 24 h TTL', async () => {
    fetchMock.mockResolvedValue(jsonResponse(brokerBody()));
    const client = build();
    const a = await client.classify('rent help', 't1');
    const b = await client.classify('rent help', 't1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
    // The first answer is stored under the `unknown` key and under the key
    // for the version it reports.
    expect(sets.map((x) => x[0]).sort()).toEqual(
      [
        classifyCacheKey('t1', 'on', 'rent help'),
        classifyCacheKey('t1', 'on', 'rent help', 'mv-1'),
      ].sort(),
    );
    expect(sets.every((x) => x[2] === TTL)).toBe(true);
  });

  it('a new model_version switches the key; the old entry is not read', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(brokerBody()))
      .mockResolvedValueOnce(
        jsonResponse(brokerBody({ model_version: 'mv-2' })),
      )
      .mockResolvedValue(jsonResponse(brokerBody({ model_version: 'mv-2' })));
    const client = build();
    await client.classify('rent help', 't1'); // call 1: sees mv-1
    await client.classify('rent help', 't1'); // hit on mv-1 key
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await client.classify('other words', 't1'); // call 2: sees mv-2, key switches
    const after = await client.classify('rent help', 't1'); // mv-2 key: miss
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(after.modelVersion).toBe('mv-2');
    await client.classify('rent help', 't1'); // now a hit
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(store.has(classifyCacheKey('t1', 'on', 'rent help', 'mv-2'))).toBe(
      true,
    );
  });

  it('keeps tenants apart', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(brokerBody()));
    const client = build();
    await client.classify('rent help', 't1');
    await client.classify('rent help', 't2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      new Set(sets.map((s) => s[0]).filter((k) => k.includes(':mv-1:'))).size,
    ).toBe(2);
  });

  it('keeps ai on and off apart', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(brokerBody()));
    const client = build();
    await client.classify('rent help', 't1', 'on');
    await client.classify('rent help', 't1', 'off');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('normalizes text for the key and for the request', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(brokerBody()));
    const client = build();
    await client.classify('  rent   help\n', 't1');
    await client.classify('rent help', 't1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).query).toBe('rent help');
  });

  describe.each([
    ['HTTP 500', () => jsonResponse({ detail: 'boom' }, 500)],
    ['network error', () => Promise.reject(new Error('ECONNRESET'))],
    [
      'emergency status error',
      () => jsonResponse(brokerBody({ emergency: errorEmergency })),
    ],
    [
      'needs status error',
      () => jsonResponse(brokerBody({ needs: { scores: [] }, urgency: null })),
    ],
    ['no emergency', () => jsonResponse(brokerBody({ emergency: undefined }))],
  ])('failure is not stored: %s', (_name, respond) => {
    it('returns the error result, writes nothing, fetches again next time', async () => {
      fetchMock.mockImplementation(async () => respond());
      const client = build();
      const a = await client.classify('rent help', 't1');
      const isBad =
        a.signals.needs.status === 'error' ||
        a.signals.emergency?.status === 'error' ||
        !a.signals.emergency;
      expect(isBad).toBe(true);
      expect(sets).toHaveLength(0);
      await client.classify('rent help', 't1');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(sets).toHaveLength(0);
    });
  });

  it('concurrent calls with an error body fetch once and store nothing', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(brokerBody({ emergency: errorEmergency })),
    );
    const client = build();
    const [a, b] = await Promise.all([
      client.classify('rent help', 't1'),
      client.classify('rent help', 't1'),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.signals.emergency?.status).toBe('error');
    expect(b).toEqual(a);
    expect(sets).toHaveLength(0);
  });

  it.each([
    ['a string', 'garbage'],
    [
      'error signals',
      {
        signals: { needs: { status: 'error' }, emergency: { status: 'error' } },
        scores: {},
        modelVersion: null,
      },
    ],
  ])('a corrupt cached value (%s) counts as a miss', async (_n, bad) => {
    store.set(classifyCacheKey('t1', 'on', 'rent help'), bad);
    fetchMock.mockResolvedValue(jsonResponse(brokerBody()));
    const r = await build().classify('rent help', 't1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.signals.emergency?.status).toBe('ok');
  });

  it('still classifies when the Redis read fails', async () => {
    getFails = true;
    fetchMock.mockResolvedValue(jsonResponse(brokerBody()));
    const r = await build().classify('rent help', 't1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.signals.emergency?.status).toBe('ok');
  });

  it('CLASSIFY_CACHE_ENABLED=false skips the cache', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(brokerBody()));
    const client = build({ CLASSIFY_CACHE_ENABLED: 'false' });
    await client.classify('rent help', 't1');
    await client.classify('rent help', 't1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sets).toHaveLength(0);
  });

  it('holds no query text in the key or the value', async () => {
    fetchMock.mockResolvedValue(jsonResponse(brokerBody()));
    await build().classify('very private words', 't1');
    const [key, value] = sets[0];
    expect(key).not.toContain('private');
    expect(JSON.stringify(value)).not.toContain('private');
  });

  it('sets v2.classify.cache_hit false on a miss and true on a hit', async () => {
    const setAttribute = jest.fn();
    jest.spyOn(trace, 'getActiveSpan').mockReturnValue({ setAttribute } as any);
    fetchMock.mockResolvedValue(jsonResponse(brokerBody()));
    const client = build();
    await client.classify('rent help', 't1');
    await client.classify('rent help', 't1');
    expect(setAttribute).toHaveBeenNthCalledWith(
      1,
      'v2.classify.cache_hit',
      false,
    );
    expect(setAttribute).toHaveBeenNthCalledWith(
      2,
      'v2.classify.cache_hit',
      true,
    );
  });
});
