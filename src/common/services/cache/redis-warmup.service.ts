import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

/** Longest time start-up waits for the Redis connection. */
export const REDIS_WARMUP_TIMEOUT_MS = 2000;
export const REDIS_WARMUP_KEY = '__norse_redis_warmup__';

/**
 * The cache-manager Redis store connects on its first operation, so the first
 * request of a process pays the connect (270-445 ms in traces of /v2/search).
 * This service issues one cheap read at bootstrap so the connection is open
 * before the app accepts traffic. A failure or a slow Redis only logs a
 * warning: requests keep their existing behavior on Redis errors.
 */
@Injectable()
export class RedisWarmupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RedisWarmupService.name);

  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.warmUp();
  }

  async warmUp(timeoutMs = REDIS_WARMUP_TIMEOUT_MS): Promise<boolean> {
    const startedAt = Date.now();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    try {
      const outcome = await Promise.race([
        this.cacheManager.get(REDIS_WARMUP_KEY).then(() => 'ok' as const),
        timeout,
      ]);
      if (outcome === 'timeout') {
        this.logger.warn(
          `Redis warm-up did not finish within ${timeoutMs} ms; continuing start-up`,
        );
        return false;
      }
      this.logger.log(
        `Redis connection warmed up in ${Date.now() - startedAt} ms`,
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `Redis warm-up failed; continuing start-up: ${(error as Error)?.message ?? error}`,
      );
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
