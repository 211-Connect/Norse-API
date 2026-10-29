import type { MetricEntry, UmamiEventDataValue } from '../types';

export function toMetricEntries(
  rows: UmamiEventDataValue[] | undefined | null,
): MetricEntry[] {
  return (rows ?? [])
    .map((row) => ({
      x: String(row?.value ?? '').trim(),
      y: Number(row?.total) || 0,
    }))
    .filter((row) => row.x.length > 0 && row.y > 0)
    .sort((a, b) => b.y - a.y);
}

export function sumEventTotals(
  events: MetricEntry[] | undefined | null,
): Record<string, number> {
  return (events ?? []).reduce<Record<string, number>>((acc, e) => {
    if (e?.x == null) return acc;
    acc[e.x] = (acc[e.x] ?? 0) + (Number(e?.y) || 0);
    return acc;
  }, {});
}
