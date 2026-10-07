import { createHash } from 'crypto';

const toStableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => toStableValue(item));
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    );

    return Object.fromEntries(
      entries.map(([key, nestedValue]) => [key, toStableValue(nestedValue)]),
    );
  }

  return value;
};

const stableStringify = (value: unknown): string =>
  JSON.stringify(toStableValue(value));

export const hashCacheKey = (value: unknown): string =>
  createHash('sha256')
    .update(stableStringify(value))
    .digest('hex')
    .slice(0, 24);
