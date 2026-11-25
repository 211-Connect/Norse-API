import { BadRequestException } from '@nestjs/common';
import {
  HYBRID_ALIAS_EXISTS_TTL_MS,
  HybridIndexDeps,
  resolveHybridIndex,
} from './hybrid-index';

const TENANT = '11111111-1111-4111-8111-111111111111';

function deps(existsAlias: jest.Mock) {
  // Keeps successes and, like RequestCacheService, never stores a failure.
  const store = new Map<string, unknown>();
  const getOrSet = jest.fn(
    async (key: string, factory: () => Promise<unknown>) => {
      if (store.has(key)) return store.get(key);
      const value = await factory();
      store.set(key, value);
      return value;
    },
  );
  const observeDownstream = jest.fn(
    (_dep: string, _op: string, fn: () => Promise<unknown>) => fn(),
  );
  const warn = jest.fn();
  const d = {
    elasticsearch: { indices: { existsAlias } },
    cache: { getOrSet },
    metrics: { observeDownstream },
    logger: { warn },
  } as unknown as HybridIndexDeps;
  return { d, getOrSet, observeDownstream, warn };
}

describe('resolveHybridIndex', () => {
  it('returns the tenant alias when it exists', async () => {
    const existsAlias = jest.fn().mockResolvedValue(true);
    const { d } = deps(existsAlias);
    await expect(resolveHybridIndex(d, TENANT, 'en')).resolves.toBe(
      `${TENANT}-hybrid_search_resources_en`,
    );
    expect(existsAlias).toHaveBeenCalledWith({
      name: `${TENANT}-hybrid_search_resources_en`,
    });
  });

  it('passes the alias check limit to Elasticsearch when one is set', async () => {
    const existsAlias = jest.fn().mockResolvedValue(true);
    const { d } = deps(existsAlias);
    await expect(
      resolveHybridIndex({ ...d, aliasCheckLimitMs: 1000 }, TENANT, 'en'),
    ).resolves.toBe(`${TENANT}-hybrid_search_resources_en`);
    expect(existsAlias).toHaveBeenCalledWith(
      { name: `${TENANT}-hybrid_search_resources_en` },
      { requestTimeout: 1000 },
    );
  });

  it('returns the shared name when the tenant has no alias', async () => {
    const { d } = deps(jest.fn().mockResolvedValue(false));
    await expect(resolveHybridIndex(d, TENANT, 'en')).resolves.toBe(
      'hybrid_search_resources_en',
    );
  });

  it('names the alias with the same language suffix as Dagster', async () => {
    const existsAlias = jest.fn().mockResolvedValue(true);
    const { d } = deps(existsAlias);
    await expect(resolveHybridIndex(d, TENANT, 'zh-Hans')).resolves.toBe(
      `${TENANT}-hybrid_search_resources_zh_hans`,
    );
  });

  it('caches the check for a minute per alias, measured as an ES call', async () => {
    const existsAlias = jest.fn().mockResolvedValue(true);
    const { d, getOrSet, observeDownstream } = deps(existsAlias);
    await resolveHybridIndex(d, TENANT, 'es');
    await resolveHybridIndex(d, TENANT, 'es');
    expect(getOrSet).toHaveBeenCalledWith(
      `hybrid_alias_exists:${TENANT}-hybrid_search_resources_es`,
      expect.any(Function),
      HYBRID_ALIAS_EXISTS_TTL_MS,
    );
    expect(HYBRID_ALIAS_EXISTS_TTL_MS).toBe(60_000);
    expect(existsAlias).toHaveBeenCalledTimes(1);
    expect(observeDownstream).toHaveBeenCalledWith(
      'elasticsearch',
      'hybrid_alias_exists',
      expect.any(Function),
    );
  });

  it('reads the shared name and warns when the check fails, without caching it', async () => {
    const existsAlias = jest
      .fn()
      .mockRejectedValueOnce(new Error('security_exception'))
      .mockResolvedValueOnce(true);
    const { d, warn } = deps(existsAlias);
    await expect(resolveHybridIndex(d, TENANT, 'en')).resolves.toBe(
      'hybrid_search_resources_en',
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('security_exception'),
    );
    await expect(resolveHybridIndex(d, TENANT, 'en')).resolves.toBe(
      `${TENANT}-hybrid_search_resources_en`,
    );
  });

  it('rejects a lang that is not a language code before any ES call', async () => {
    const existsAlias = jest.fn();
    const { d } = deps(existsAlias);
    await expect(resolveHybridIndex(d, TENANT, '*')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(existsAlias).not.toHaveBeenCalled();
  });
});
