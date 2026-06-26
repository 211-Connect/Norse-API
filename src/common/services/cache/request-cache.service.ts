import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class RequestCacheService {
  private readonly logger = new Logger(RequestCacheService.name);

  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttlMs = DEFAULT_CACHE_TTL_MS,
  ): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) {
      this.logger.debug(`Request coalesced: ${key}`);
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
        return cacheHit;
      }
    } catch (error) {
      this.logger.warn(`Redis cache get failed for ${key}: ${error}`);
    }

    this.logger.debug(`Redis cache miss: ${key}`);
    const result = await factory();

    try {
      await this.cacheManager.set(key, result, ttlMs);
    } catch (error) {
      this.logger.warn(`Redis cache set failed for ${key}: ${error}`);
    }

    return result;
  }
}
