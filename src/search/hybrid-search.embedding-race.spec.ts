import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { InternalServerErrorException } from '@nestjs/common';
import { HybridSearchService } from './hybrid-search.service';
import { TenantConfigService } from '../cms-config/tenant-config.service';
import { RequestCacheService } from 'src/common/services/cache/request-cache.service';
import { createMetricsServiceMock } from 'src/metrics/testing/metrics-service.mock';
import { MetricsService } from 'src/metrics/metrics.service';
import { queryEmbeddingCacheKey } from './internal/cache-key/query-embedding-cache-key';

const setAttribute = jest.fn();
jest.mock('src/common/tracing/with-span', () => ({
  withSpan: (_name: string, fn: (span: unknown) => unknown) =>
    fn({ setAttribute }),
}));

const REMOTE_URL = 'https://embed.example/embeddings';
const LOCAL_URL = 'http://tei.local/v1/embeddings';
const REMOTE_VEC = [1, 2, 3];
const LOCAL_VEC = [4, 5, 6];

const ok = (v: unknown) =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ data: [{ embedding: v }] }),
  });
const status = (code: number) =>
  Promise.resolve({
    ok: false,
    status: code,
    text: () => Promise.resolve('nope'),
  });

describe('HybridSearchService embedding race', () => {
  let store: Map<string, unknown>;
  let sets: string[];
  let local: jest.Mock;
  let remote: jest.Mock;
  let fetchMock: jest.Mock;
  const realFetch = global.fetch;

  const build = async (env: Record<string, string> = {}) => {
    const module = await Test.createTestingModule({
      providers: [
        HybridSearchService,
        RequestCacheService,
        { provide: ElasticsearchService, useValue: {} },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              ({
                EMBEDDING_BASE_URL: 'https://embed.example',
                EMBEDDING_MODEL: 'model-x',
                RUNPOD_API_KEY: 'k',
                EMBEDDING_CACHE_ENABLED: 'false',
                ...env,
              })[key],
          },
        },
        { provide: TenantConfigService, useValue: {} },
        { provide: MetricsService, useValue: createMetricsServiceMock() },
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: jest.fn((k: string) => Promise.resolve(store.get(k))),
            set: jest.fn((k: string, v: unknown) => {
              sets.push(k);
              store.set(k, v);
              return Promise.resolve();
            }),
            mset: jest.fn((list: any[]) => {
              list.forEach((e) => {
                sets.push(e.key);
                store.set(e.key, e.value);
              });
              return Promise.resolve();
            }),
          },
        },
      ],
    }).compile();
    return module.get(HybridSearchService);
  };
  const withLocal = { EMBEDDING_LOCAL_BASE_URL: 'http://tei.local/v1' };
  const urls = () => fetchMock.mock.calls.map((c) => c[0]);
  const callTo = (url: string) =>
    fetchMock.mock.calls.find((c) => c[0] === url);
  const winner = () =>
    setAttribute.mock.calls.find((c) => c[0] === 'hybrid.embed_winner')?.[1];
  // Well past the 15 ms side delays, so the slow side has settled.
  const flush = () => new Promise((r) => setTimeout(r, 60));

  beforeEach(() => {
    store = new Map();
    sets = [];
    setAttribute.mockClear();
    local = jest.fn(() => ok(LOCAL_VEC));
    remote = jest.fn(() => ok(REMOTE_VEC));
    fetchMock = jest.fn((url: string) =>
      url === LOCAL_URL ? local() : remote(),
    );
    global.fetch = fetchMock as any;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  it.each([[undefined], ['   ']])(
    'empty env %p keeps one call to the remote URL',
    async (value) => {
      const service = await build(
        value === undefined ? {} : { EMBEDDING_LOCAL_BASE_URL: value },
      );
      expect(await service.embedQuery('food bank', 'v2')).toEqual(REMOTE_VEC);
      expect(urls()).toEqual([REMOTE_URL]);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        model: 'model-x',
        input: 'food bank',
      });
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer k');
      expect(winner()).toBeUndefined();
    },
  );

  it('TEI wins when it answers first; remote is still called', async () => {
    let release: (v: unknown) => void;
    remote.mockImplementation(
      () => new Promise((res) => (release = () => res(ok(REMOTE_VEC)))),
    );
    const service = await build(withLocal);
    expect(await service.embedQuery('food bank', 'v2')).toEqual(LOCAL_VEC);
    expect(urls().sort()).toEqual([LOCAL_URL, REMOTE_URL].sort());
    expect(callTo(LOCAL_URL)[1].headers.Authorization).toBeUndefined();
    expect(callTo(REMOTE_URL)[1].headers.Authorization).toBe('Bearer k');
    expect(JSON.parse(callTo(LOCAL_URL)[1].body)).toEqual({
      model: 'BAAI/bge-m3',
      input: 'food bank',
    });
    expect(JSON.parse(callTo(REMOTE_URL)[1].body)).toEqual({
      model: 'model-x',
      input: 'food bank',
    });
    expect(winner()).toBe('local');
    release(undefined);
    await flush();
  });

  it('OpenRouter wins when it answers first', async () => {
    local.mockImplementation(
      () => new Promise((res) => setTimeout(() => res(ok(LOCAL_VEC)), 15)),
    );
    const service = await build(withLocal);
    expect(await service.embedQuery('food bank', 'v2')).toEqual(REMOTE_VEC);
    expect(winner()).toBe('remote');
    await flush();
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('conn refused'))],
    ['returns 503', () => status(503)],
    ['returns an empty vector', () => ok([])],
  ])('TEI %s: remote wins', async (_n, impl) => {
    local.mockImplementation(impl);
    remote.mockImplementation(
      () => new Promise((res) => setTimeout(() => res(ok(REMOTE_VEC)), 10)),
    );
    const service = await build(withLocal);
    expect(await service.embedQuery('food bank', 'v2')).toEqual(REMOTE_VEC);
    expect(winner()).toBe('remote');
  });

  it('OpenRouter 500: local wins', async () => {
    remote.mockImplementation(() => status(500));
    const service = await build(withLocal);
    expect(await service.embedQuery('food bank', 'v2')).toEqual(LOCAL_VEC);
    expect(winner()).toBe('local');
    await flush();
  });

  it('both down: InternalServerErrorException and winner none', async () => {
    local.mockImplementation(() => status(503));
    remote.mockImplementation(() => status(500));
    const service = await build(withLocal);
    await expect(service.embedQuery('food bank', 'v2')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(winner()).toBe('none');
  });

  describe('v1 stays on EMBEDDING_BASE_URL (Lucas 2026-11-25)', () => {
    const cacheOn = { ...withLocal, EMBEDDING_CACHE_ENABLED: 'true' };
    const REMOTE_KEY = queryEmbeddingCacheKey('remote', 'model-x', 'food bank');
    const RACE_KEY = queryEmbeddingCacheKey('race', 'model-x', 'food bank');
    /** The remote side answers after the local side, so local wins a race. */
    const slowRemote = () =>
      remote.mockImplementation(
        () => new Promise((res) => setTimeout(() => res(ok(REMOTE_VEC)), 15)),
      );

    it.each([[undefined], ['v1' as const]])(
      'version %p makes no TEI call and sets no winner',
      async (version) => {
        const service = await build(withLocal);
        expect(await service.embedQuery('food bank', version)).toEqual(
          REMOTE_VEC,
        );
        expect(urls()).toEqual([REMOTE_URL]);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
          model: 'model-x',
          input: 'food bank',
        });
        expect(winner()).toBeUndefined();
      },
    );

    it('startEmbedding passes the version on', async () => {
      const service = await build(withLocal);
      await service.startEmbedding('food bank');
      expect(urls()).toEqual([REMOTE_URL]);
      await service.startEmbedding('food bank', 'v2');
      expect(urls().filter((u) => u === LOCAL_URL)).toHaveLength(1);
      await flush();
    });

    it('OpenRouter down: v1 fails as before, v2 answers from TEI', async () => {
      remote.mockImplementation(() => status(500));
      const service = await build(cacheOn);
      await expect(service.embedQuery('food bank')).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
      expect(local).not.toHaveBeenCalled();
      expect(winner()).toBeUndefined();
      expect(sets).toEqual([]);
      expect(await service.startEmbedding('food bank')).toBeUndefined();
      expect(local).not.toHaveBeenCalled();

      expect(await service.embedQuery('food bank', 'v2')).toEqual(LOCAL_VEC);
      // v2's stored TEI vector does not rescue v1.
      await expect(service.embedQuery('food bank')).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
      await flush();
    });

    it('TEI down: v1 sees nothing of it', async () => {
      local.mockImplementation(() => Promise.reject(new Error('refused')));
      const service = await build(cacheOn);
      expect(await service.embedQuery('food bank')).toEqual(REMOTE_VEC);
      expect(local).not.toHaveBeenCalled();
    });

    it('v1 never reads what v2 stored', async () => {
      slowRemote();
      const service = await build(cacheOn);
      expect(await service.embedQuery('food bank', 'v2')).toEqual(LOCAL_VEC);
      await flush();
      expect(sets).toEqual([RACE_KEY]);
      expect(await service.embedQuery('food bank', 'v1')).toEqual(REMOTE_VEC);
      // v1 uses no cache (as tag v1.6.0): it writes nothing.
      expect(sets).toEqual([RACE_KEY]);
    });

    it('v2 with TEI never reads what v1 stored', async () => {
      slowRemote();
      const service = await build(cacheOn);
      expect(await service.embedQuery('food bank', 'v1')).toEqual(REMOTE_VEC);
      expect(await service.embedQuery('food bank', 'v2')).toEqual(LOCAL_VEC);
      // v1 wrote nothing, so only the v2 entry exists.
      expect(sets).toEqual([RACE_KEY]);
      await flush();
    });

    it('concurrent v1 and v2 calls do not share one in-flight answer', async () => {
      slowRemote();
      const service = await build(cacheOn);
      const [v2, v1] = await Promise.all([
        service.embedQuery('food bank', 'v2'),
        service.embedQuery('food bank', 'v1'),
      ]);
      expect(v2).toEqual(LOCAL_VEC);
      expect(v1).toEqual(REMOTE_VEC);
      await flush();
    });

    it('v1 does not read a vector stored under the key of older builds', async () => {
      // Those builds stored a TEI vector under one key for v1 and v2.
      const { packEmbedding } = jest.requireActual<
        typeof import('./internal/embedding-codec')
      >('./internal/embedding-codec');
      const old = REMOTE_KEY.replace(':remote:v1:', ':v1:');
      expect(old).not.toBe(REMOTE_KEY);
      store.set(old, packEmbedding(LOCAL_VEC));
      const service = await build(cacheOn);
      expect(await service.embedQuery('food bank')).toEqual(REMOTE_VEC);
    });

    it('a corrupt entry is refetched from the right side only', async () => {
      slowRemote();
      const service = await build(cacheOn);
      store.set(REMOTE_KEY, 'garbage!!');
      store.set(RACE_KEY, 'garbage!!');
      expect(await service.embedQuery('food bank', 'v1')).toEqual(REMOTE_VEC);
      expect(local).not.toHaveBeenCalled();
      expect(await service.embedQuery('food bank', 'v2')).toEqual(LOCAL_VEC);
      expect(sets).toEqual([RACE_KEY]);
      await flush();
    });

    it.each([[undefined], ['   ']])(
      'local address %p: v1 sends raw text and bypasses the v2 remote entry',
      async (value) => {
        const service = await build({
          EMBEDDING_CACHE_ENABLED: 'true',
          ...(value !== undefined && { EMBEDDING_LOCAL_BASE_URL: value }),
        });
        await service.embedQuery('  food   bank ', 'v2');
        expect(await service.embedQuery('food bank')).toEqual(REMOTE_VEC);
        expect(sets).toEqual([REMOTE_KEY]);
        expect(urls()).toEqual([REMOTE_URL, REMOTE_URL]);
      },
    );
  });
});
