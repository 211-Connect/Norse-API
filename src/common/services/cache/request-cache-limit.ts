import { ConfigService } from '@nestjs/config';
import { envFlag } from 'src/common/config/configuration';

/**
 * The one default of env `REQUEST_CACHE_LIMIT_ENABLED` (any case; read by
 * envFlag). Off: the request cache waits for Redis with no limit, as before.
 */
export const REQUEST_CACHE_LIMIT_DEFAULT_ON = false;

/**
 * Longest wait for one request-Redis read or write, in ms. A Redis PING from
 * the pod takes 2 ms (measured 2026-11-17), so this cuts a hang, not a slow
 * answer. A cold connect (270-445 ms in traces) can pass it: that read is a miss.
 */
export const REQUEST_CACHE_LIMIT_MS = 250;

/**
 * Longest wait for the hybrid alias check, in ms. One Elasticsearch call takes
 * about 7 ms from the pod (measured 2026-11-17). Past it the search reads the
 * shared index, as before the alias lookup existed.
 */
export const HYBRID_ALIAS_CHECK_LIMIT_MS = 1000;

export function requestCacheLimitEnabled(
  config: Pick<ConfigService, 'get'>,
): boolean {
  return envFlag(
    config.get<string>('REQUEST_CACHE_LIMIT_ENABLED'),
    REQUEST_CACHE_LIMIT_DEFAULT_ON,
  );
}
