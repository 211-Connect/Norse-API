import type {
  MetricEntry,
  MetricsExpandedEntry,
  UmamiEventDataValue,
} from '../types';

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

function stripTrailingSlash(name: string): string {
  const qIndex = name.indexOf('?');
  if (qIndex > 0 && name[qIndex - 1] === '/') {
    return name.slice(0, qIndex - 1) + name.slice(qIndex);
  }
  if (qIndex === -1 && name.endsWith('/')) {
    return name.slice(0, -1);
  }
  return name;
}

function stripQueryString(name: string): string {
  const qIndex = name.indexOf('?');
  return qIndex === -1 ? name : name.slice(0, qIndex);
}

export function parseMetrics(
  metricsData: MetricsExpandedEntry[] | undefined | null,
  hasTrailingSlash = false,
): {
  searchCount: number;
  resourceMetrics: MetricEntry[];
} {
  let searchCount = 0;
  const resourceMetrics: MetricEntry[] = [];

  for (const metricData of metricsData ?? []) {
    if (metricData?.name == null) continue;
    const name = hasTrailingSlash
      ? stripTrailingSlash(metricData.name)
      : metricData.name;
    const pathOnly = stripQueryString(name);
    const isRoot = pathOnly === '/search' || pathOnly.endsWith('/search');
    if (isRoot) {
      searchCount += Number(metricData.pageviews) || 0;
    } else if (name.includes('/search/')) {
      resourceMetrics.push({
        x: name,
        y: Number(metricData.pageviews) || 0,
      });
    }
  }

  resourceMetrics.sort((a, b) => b.y - a.y);

  return { searchCount, resourceMetrics };
}
