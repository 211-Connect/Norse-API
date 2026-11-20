import { Cache } from 'cache-manager';
import {
  REDIS_WARMUP_KEY,
  REDIS_WARMUP_TIMEOUT_MS,
  RedisWarmupService,
} from './redis-warmup.service';

describe('RedisWarmupService', () => {
  const build = (get: jest.Mock) =>
    new RedisWarmupService({ get } as unknown as Cache);

  afterEach(() => jest.useRealTimers());

  it('reads one key through the cache at bootstrap', async () => {
    const get = jest.fn().mockResolvedValue(undefined);
    await build(get).onApplicationBootstrap();
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(REDIS_WARMUP_KEY);
  });

  it('returns true when Redis answers', async () => {
    const get = jest.fn().mockResolvedValue(undefined);
    await expect(build(get).warmUp()).resolves.toBe(true);
  });

  it('does not throw when Redis fails', async () => {
    const get = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(build(get).onApplicationBootstrap()).resolves.toBeUndefined();
    await expect(build(get).warmUp()).resolves.toBe(false);
  });

  it('does not throw when the cache throws synchronously', async () => {
    const get = jest.fn().mockImplementation(() => {
      throw new Error('boom');
    });
    await expect(build(get).warmUp()).resolves.toBe(false);
  });

  it('stops waiting after the bound when Redis hangs', async () => {
    jest.useFakeTimers();
    const get = jest.fn().mockReturnValue(new Promise(() => undefined));
    const done = build(get).onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(REDIS_WARMUP_TIMEOUT_MS - 1);
    let settled = false;
    void done.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await expect(done).resolves.toBeUndefined();
  });
});
