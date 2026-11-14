import { RequestCacheService } from './request-cache.service';

describe('RequestCacheService many-key calls', () => {
  const build = (cache: Record<string, jest.Mock>) => {
    const metrics = { recordCacheAccess: jest.fn() };
    const service = new RequestCacheService(cache as any, metrics as any);
    return { service, metrics };
  };

  it('getMany returns the values in key order, undefined for a miss', async () => {
    const mget = jest.fn().mockResolvedValue([{ a: 1 }, undefined, null]);
    const { service, metrics } = build({ mget });
    await expect(service.getMany(['k1', 'k2', 'k3'])).resolves.toEqual([
      { a: 1 },
      undefined,
      undefined,
    ]);
    expect(mget).toHaveBeenCalledWith(['k1', 'k2', 'k3']);
    expect(metrics.recordCacheAccess).toHaveBeenCalledWith(
      'request-redis',
      'hit',
    );
    expect(metrics.recordCacheAccess).toHaveBeenCalledWith(
      'request-redis',
      'miss',
    );
  });

  it('getMany makes no call for an empty list', async () => {
    const mget = jest.fn();
    const { service } = build({ mget });
    await expect(service.getMany([])).resolves.toEqual([]);
    expect(mget).not.toHaveBeenCalled();
  });

  it('getMany treats a cache failure as all misses', async () => {
    const mget = jest.fn().mockRejectedValue(new Error('redis down'));
    const { service, metrics } = build({ mget });
    await expect(service.getMany(['k1', 'k2'])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(metrics.recordCacheAccess).toHaveBeenCalledWith(
      'request-redis',
      'get-error',
    );
  });

  it('setMany writes every entry with the same lifetime', async () => {
    const mset = jest.fn().mockResolvedValue(undefined);
    const { service } = build({ mset });
    await service.setMany({ k1: 1, k2: 2 }, 1000);
    expect(mset).toHaveBeenCalledWith([
      { key: 'k1', value: 1, ttl: 1000 },
      { key: 'k2', value: 2, ttl: 1000 },
    ]);
  });

  it('setMany swallows a cache failure', async () => {
    const mset = jest.fn().mockRejectedValue(new Error('redis down'));
    const { service } = build({ mset });
    await expect(service.setMany({ k1: 1 }, 1000)).resolves.toBeUndefined();
  });

  it('setMany makes no call for no entries', async () => {
    const mset = jest.fn();
    const { service } = build({ mset });
    await service.setMany({}, 1000);
    expect(mset).not.toHaveBeenCalled();
  });
});
