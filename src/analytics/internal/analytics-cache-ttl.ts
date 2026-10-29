import { startOfDay } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

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
