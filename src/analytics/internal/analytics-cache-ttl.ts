import { startOfDay } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

import {
  ANALYTICS_CDN_TTL_CLOSED_RANGE_S,
  ANALYTICS_CDN_TTL_OPEN_RANGE_S,
} from './constants';

export function getStartOfDayInTimezone(timezone?: string): number {
  const tz = timezone && timezone.length > 0 ? timezone : 'UTC';

  try {
    const now = new Date();
    const zonedNow = toZonedTime(now, tz);
    const startZoned = startOfDay(zonedNow);
    return fromZonedTime(startZoned, tz).getTime();
  } catch {
    return new Date().setUTCHours(0, 0, 0, 0);
  }
}

export function isClosedRange(endMs: number, timezone?: string): boolean {
  return endMs < getStartOfDayInTimezone(timezone);
}

export function resolveCdnTtl(
  endpoint: string,
  endMs: number,
  timezone?: string,
): number {
  if (endpoint === 'sessions') {
    return ANALYTICS_CDN_TTL_OPEN_RANGE_S;
  }

  return isClosedRange(endMs, timezone)
    ? ANALYTICS_CDN_TTL_CLOSED_RANGE_S
    : ANALYTICS_CDN_TTL_OPEN_RANGE_S;
}
