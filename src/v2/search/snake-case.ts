const toSnake = (key: string): string =>
  key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Recursively renames object keys from camelCase to snake_case; values stay as they are. */
export function toSnakeCaseKeys<T = unknown>(value: unknown): T {
  if (Array.isArray(value)) return value.map((v) => toSnakeCaseKeys(v)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [toSnake(k), toSnakeCaseKeys(v)]),
    ) as T;
  }
  return value as T;
}
