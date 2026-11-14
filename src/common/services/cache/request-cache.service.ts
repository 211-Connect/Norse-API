import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { MetricsService } from 'src/metrics/metrics.service';

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class RequestCacheService {
  private readonly logger = new Logger(RequestCacheService.name);

  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly metrics: MetricsService,
  ) {}

  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttlMs = DEFAULT_CACHE_TTL_MS,
  ): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) {
      this.logger.debug(`Request coalesced: ${key}`);
      this.metrics.recordCacheAccess('request-redis', 'coalesced');
      return existing as Promise<T>;
    }

    const promise = this.fetchAndCache(key, factory, ttlMs);
    this.inflight.set(key, promise);

    promise
      .catch(() => {
        // Errors are propagated and intentionally not cached.
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    return promise;
  }

  private async fetchAndCache<T>(
    key: string,
    factory: () => Promise<T>,
    ttlMs: number,
  ): Promise<T> {
    try {
      const cacheHit = await this.cacheManager.get<T>(key);
      if (cacheHit !== undefined && cacheHit !== null) {
        this.logger.debug(`Redis cache hit: ${key}`);
        this.metrics.recordCacheAccess('request-redis', 'hit');
        return cacheHit;
      }
    } catch (error) {
      this.logger.warn(`Redis cache get failed for ${key}: ${error}`);
      this.metrics.recordCacheAccess('request-redis', 'get-error');
    }

    this.logger.debug(`Redis cache miss: ${key}`);
    this.metrics.recordCacheAccess('request-redis', 'miss');
    const result = await factory();

    try {
      await this.cacheManager.set(key, result, ttlMs);
    } catch (error) {
      this.logger.warn(`Redis cache set failed for ${key}: ${error}`);
    }

    return result;
  }

  /**
   * Reads many keys with one cache round trip. Values come back in key order;
   * a miss is `undefined`. Never rejects: a cache failure counts as all misses.
   */
  async getMany<T>(keys: string[]): Promise<Array<T | undefined>> {
    if (keys.length === 0) return [];
    try {
      const values = await this.cacheManager.mget<T>(keys);
      return keys.map((key, i) => {
        const value = values[i];
        if (value === undefined || value === null) {
          this.metrics.recordCacheAccess('request-redis', 'miss');
          return undefined;
        }
        this.logger.debug(`Redis cache hit: ${key}`);
        this.metrics.recordCacheAccess('request-redis', 'hit');
        return value;
      });
    } catch (error) {
      this.logger.warn(
        `Redis cache mget failed for ${keys.length} keys: ${error}`,
      );
      this.metrics.recordCacheAccess('request-redis', 'get-error');
      return keys.map(() => undefined);
    }
  }

  /** Writes many keys with one lifetime. Never rejects. */
  async setMany(
    entries: Record<string, unknown>,
    ttlMs = DEFAULT_CACHE_TTL_MS,
  ): Promise<void> {
    const list = Object.entries(entries).map(([key, value]) => ({
      key,
      value,
      ttl: ttlMs,
    }));
    if (list.length === 0) return;
    try {
      await this.cacheManager.mset(list);
    } catch (error) {
      this.logger.warn(
        `Redis cache mset failed for ${list.length} keys: ${error}`,
      );
    }
  }

  /** Deletes many keys with one cache round trip. Never rejects. */
  async deleteMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.cacheManager.mdel(keys);
    } catch (error) {
      this.logger.warn(
        `Redis cache mdel failed for ${keys.length} keys: ${error}`,
      );
    }
  }
}
