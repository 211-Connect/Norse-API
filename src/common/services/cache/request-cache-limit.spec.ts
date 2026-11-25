import { HybridSearchService } from 'src/search/hybrid-search.service';
import {
  HYBRID_ALIAS_CHECK_LIMIT_MS,
  REQUEST_CACHE_LIMIT_DEFAULT_ON,
  REQUEST_CACHE_LIMIT_MS,
  requestCacheLimitEnabled,
} from './request-cache-limit';
import { RequestCacheService } from './request-cache.service';

const never = () => new Promise<never>(() => undefined);

function build(
  cache: Record<string, jest.Mock>,
  env: string | undefined = 'true',
) {
  const metrics = { recordCacheAccess: jest.fn() };
  const config = {
    get: (key: string) =>
      key === 'REQUEST_CACHE_LIMIT_ENABLED' ? env : undefined,
  };
  const service = new RequestCacheService(
    cache as any,
    metrics as any,
    config as any,
  );
  return { service, metrics };
}

/** 'pending' when the promise has not settled after `ms` of fake time. */
async function after<T>(promise: Promise<T>, ms: number) {
  let state: unknown = 'pending';
  promise.then(
    (value) => (state = value),
    (error) => (state = error),
  );
  await jest.advanceTimersByTimeAsync(ms);
  return state;
}

describe('request cache limit switch', () => {
  it('is on by default, off only for false, and reads REQUEST_CACHE_LIMIT_ENABLED with envFlag', () => {
    const read = (value?: string) =>
      requestCacheLimitEnabled({ get: () => value } as any);
    expect(REQUEST_CACHE_LIMIT_DEFAULT_ON).toBe(true);
    expect(read(undefined)).toBe(REQUEST_CACHE_LIMIT_DEFAULT_ON);
    expect(read('')).toBe(REQUEST_CACHE_LIMIT_DEFAULT_ON);
    expect(read('1')).toBe(REQUEST_CACHE_LIMIT_DEFAULT_ON);
    expect(read('TRUE')).toBe(true);
    expect(read('false')).toBe(false);
  });
});

describe('RequestCacheService with a request Redis that hangs', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('a hung read counts as a miss and skips the write', async () => {
    const set = jest.fn();
    const { service, metrics } = build({ get: jest.fn(never), set });
    const answer = service.getOrSet('k', async () => 'fresh');
    expect(await after(answer, REQUEST_CACHE_LIMIT_MS)).toBe('fresh');
    expect(set).not.toHaveBeenCalled();
    expect(metrics.recordCacheAccess).toHaveBeenCalledWith(
      'request-redis',
      'get-error',
    );
  });

  it('a hung write does not hold the answer past the limit', async () => {
    const { service } = build({
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn(never),
    });
    const answer = service.getOrSet('k', async () => 'fresh');
    expect(await after(answer, REQUEST_CACHE_LIMIT_MS)).toBe('fresh');
  });

  it('a joined in-flight call gets the answer and the key is free again', async () => {
    const factory = jest.fn(async () => 'fresh');
    const { service } = build({ get: jest.fn(never), set: jest.fn(never) });
    const first = service.getOrSet('k', factory);
    const second = service.getOrSet('k', factory);
    expect(await after(Promise.all([first, second]), 250)).toEqual([
      'fresh',
      'fresh',
    ]);
    expect(factory).toHaveBeenCalledTimes(1);
    const third = service.getOrSet('k', factory);
    expect(await after(third, REQUEST_CACHE_LIMIT_MS)).toBe('fresh');
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('the limit does not cut the factory', async () => {
    const { service } = build({
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    });
    const answer = service.getOrSet(
      'k',
      () => new Promise((r) => setTimeout(() => r('slow'), 9000)),
    );
    expect(await after(answer, 8999)).toBe('pending');
    expect(await after(answer, 1)).toBe('slow');
  });

  it('a late rejection of a cut read is not unhandled', async () => {
    let fail: (error: Error) => void;
    const get = jest.fn(() => new Promise((_, reject) => (fail = reject)));
    const { service } = build({ get, set: jest.fn() });
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    const answer = service.getOrSet('k', async () => 'fresh');
    expect(await after(answer, REQUEST_CACHE_LIMIT_MS)).toBe('fresh');
    fail(new Error('socket closed'));
    jest.useRealTimers();
    await new Promise((r) => setImmediate(r));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('getMany reads a hang as all misses, setMany and deleteMany return', async () => {
    const { service } = build({
      mget: jest.fn(never),
      mset: jest.fn(never),
      mdel: jest.fn(never),
    });
    expect(await after(service.getMany(['a', 'b']), 250)).toEqual([
      undefined,
      undefined,
    ]);
    expect(await after(service.setMany({ a: 1 }), 250)).toBeUndefined();
    expect(await after(service.deleteMany(['a']), 250)).toBeUndefined();
  });

  it('leaves no timer behind after a fast answer', async () => {
    const { service } = build({
      get: jest.fn().mockResolvedValue('hit'),
    });
    await expect(service.getOrSet('k', async () => 'fresh')).resolves.toBe(
      'hit',
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a rejected read still writes the fresh value, as before', async () => {
    const set = jest.fn().mockResolvedValue(undefined);
    const { service } = build({
      get: jest.fn().mockRejectedValue(new Error('redis error')),
      set,
    });
    await expect(service.getOrSet('k', async () => 'fresh')).resolves.toBe(
      'fresh',
    );
    expect(set).toHaveBeenCalledTimes(1);
  });

  it.each(['false', 'FALSE'])(
    'switch %s: waits for Redis with no limit, as before',
    async (env) => {
      const config = { get: () => env };
      const service = new RequestCacheService(
        { get: jest.fn(never), mget: jest.fn(never) } as any,
        { recordCacheAccess: jest.fn() } as any,
        config as any,
      );
      const factory = jest.fn(async () => 'fresh');
      expect(await after(service.getOrSet('k', factory), 60_000)).toBe(
        'pending',
      );
      expect(await after(service.getMany(['a']), 60_000)).toBe('pending');
      expect(factory).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    },
  );
});

describe('HybridSearchService alias check', () => {
  const aliasCall = async (env: string | undefined) => {
    const existsAlias = jest.fn().mockResolvedValue(true);
    const service = new HybridSearchService(
      { indices: { existsAlias } } as any,
      {
        get: (key: string) =>
          key === 'REQUEST_CACHE_LIMIT_ENABLED' ? env : undefined,
      } as any,
      {} as any,
      {
        getOrSet: (_: string, factory: () => Promise<unknown>) => factory(),
      } as any,
      {
        observeDownstream: (_: string, __: string, fn: () => unknown) => fn(),
      } as any,
    );
    await (service as any).resolveHybridIndex('t', 'en');
    return existsAlias.mock.calls[0];
  };
  const name = 't-hybrid_search_resources_en';

  it.each([undefined, 'true'])('switch %s: has the limit', async (v) => {
    expect(await aliasCall(v)).toEqual([
      { name },
      { requestTimeout: HYBRID_ALIAS_CHECK_LIMIT_MS },
    ]);
  });

  it.each(['false', 'FALSE'])('switch %s: the call is as before', async (v) => {
    expect(await aliasCall(v)).toEqual([{ name }]);
  });
});
