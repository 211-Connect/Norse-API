export const AUTH_VERIFY_TIMEOUT_MS = 5_000;
export const AUTH_LOGIN_TIMEOUT_MS = 10_000;
export const ANALYTICS_FETCH_TIMEOUT_MS = 60_000;
export const ONE_DAY_MS = 86_400_000;
export const MAX_RANGE_DAYS = 365;

/**
 * Cache TTLs for analytics responses.
 *
 * OPEN_RANGE:   used when the requested end date is today or in the future —
 *               data may still change, so we cache briefly.
 * CLOSED_RANGE: used when the range is fully in the past — data is immutable,
 *               so we cache aggressively.
 *
 * Values are in milliseconds (as required by cache-manager).
 */
export const ANALYTICS_CACHE_TTL_OPEN_RANGE_MS = 5 * 60 * 1_000; // 5 minutes
export const ANALYTICS_CACHE_TTL_CLOSED_RANGE_MS = 60 * 60 * 1_000; // 1 hour

/** CDN / reverse-proxy max-age equivalents in seconds */
export const ANALYTICS_CDN_TTL_OPEN_RANGE_S = 5 * 60; // 5 minutes
export const ANALYTICS_CDN_TTL_CLOSED_RANGE_S = 60 * 60; // 1 hour

export type ALLOWED_ENDPOINT =
  | 'pageviews'
  | 'stats'
  | 'events/series'
  | 'metrics/expanded'
  | 'event-data/values'
  | 'event-data-pivot'
  | 'sessions';
