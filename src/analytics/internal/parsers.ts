import type {
  MetricEntry,
  MetricsExpandedEntry,
  SearchByLabelByType,
  SearchQueryType,
  UmamiEventDataValue,
} from '../types';
import { isSearchQueryType } from './search-query-type';

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

export function parseMetrics(
  metricsData: MetricsExpandedEntry[] | undefined | null,
  queryMetricsData: MetricsExpandedEntry[] | undefined | null,
): {
  searchCount: number;
  resourceMetrics: MetricEntry[];
  searchByLabelByType: SearchByLabelByType;
} {
  let searchCount = 0;
  const resourceMetrics: MetricEntry[] = [];

  for (const metricData of metricsData ?? []) {
    if (metricData?.name == null) continue;
    if (metricData.name === '/search' || metricData.name.endsWith('/search')) {
      searchCount += Number(metricData.pageviews) || 0;
    } else if (metricData.name.includes('/search/')) {
      resourceMetrics.push({
        x: metricData.name,
        y: Number(metricData.pageviews) || 0,
      });
    }
  }

  resourceMetrics.sort((a, b) => b.y - a.y);

  const labelByTypeMaps: Record<SearchQueryType, Map<string, number>> = {
    text: new Map<string, number>(),
    taxonomy: new Map<string, number>(),
    hybrid: new Map<string, number>(),
  };

  for (const m of queryMetricsData ?? []) {
    if (m?.name == null) continue;
    const params = new URLSearchParams(m.name);
    const label = params.get('query_label');
    if (label === null) continue;
    const rawType = params.get('query_type');
    if (!isSearchQueryType(rawType)) continue;
    const views = Number(m.pageviews) || 0;
    const bucket = labelByTypeMaps[rawType];
    bucket.set(label, (bucket.get(label) ?? 0) + views);
  }

  const toSortedEntries = (map: Map<string, number>): MetricEntry[] =>
    Array.from(map, ([x, y]) => ({ x, y })).sort((a, b) => b.y - a.y);

  const searchByLabelByType: SearchByLabelByType = {
    text: toSortedEntries(labelByTypeMaps.text),
    taxonomy: toSortedEntries(labelByTypeMaps.taxonomy),
    hybrid: toSortedEntries(labelByTypeMaps.hybrid),
  };

  return { searchCount, resourceMetrics, searchByLabelByType };
}
