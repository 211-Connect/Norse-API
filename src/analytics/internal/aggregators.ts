import type {
  MetricEntry,
  MetricsExpandedEntry,
  Stats,
  UmamiEventDataValue,
  UmamiEventDataPivotResponse,
  UmamiEventDataPivotRow,
  UmamiSession,
} from '../types';
import { ALLOWED_ENDPOINT } from './constants';

export function mergeStats(dataList: Partial<Stats>[]): Stats {
  return dataList.reduce<Stats>(
    (acc, row) => ({
      bounces: acc.bounces + (Number(row?.bounces) || 0),
      pageviews: acc.pageviews + (Number(row?.pageviews) || 0),
      totaltime: acc.totaltime + (Number(row?.totaltime) || 0),
      visitors: acc.visitors + (Number(row?.visitors) || 0),
      visits: acc.visits + (Number(row?.visits) || 0),
      comparison: {
        bounces:
          acc.comparison.bounces + (Number(row?.comparison?.bounces) || 0),
        pageviews:
          acc.comparison.pageviews + (Number(row?.comparison?.pageviews) || 0),
        totaltime:
          acc.comparison.totaltime + (Number(row?.comparison?.totaltime) || 0),
        visitors:
          acc.comparison.visitors + (Number(row?.comparison?.visitors) || 0),
        visits: acc.comparison.visits + (Number(row?.comparison?.visits) || 0),
      },
    }),
    {
      bounces: 0,
      pageviews: 0,
      totaltime: 0,
      visitors: 0,
      visits: 0,
      comparison: {
        bounces: 0,
        pageviews: 0,
        totaltime: 0,
        visitors: 0,
        visits: 0,
      },
    },
  );
}

export function mergeMetricEntries(
  entriesList: MetricEntry[][],
): MetricEntry[] {
  const merged = new Map<string, number>();

  for (const entries of entriesList ?? []) {
    for (const entry of entries ?? []) {
      const x = entry?.x;
      if (x == null) continue;
      merged.set(x, (merged.get(x) ?? 0) + (Number(entry?.y) || 0));
    }
  }

  return Array.from(merged, ([x, y]) => ({ x, y }));
}

export function mergeMetricsExpanded(
  dataList: MetricsExpandedEntry[][],
): MetricsExpandedEntry[] {
  const merged = new Map<
    string,
    {
      pageviews: number;
      visitors: number;
      visits: number;
      bounces: number;
      totaltime: number;
    }
  >();

  for (const rows of dataList ?? []) {
    for (const row of rows ?? []) {
      if (row?.name == null) continue;
      const current = merged.get(row.name) ?? {
        pageviews: 0,
        visitors: 0,
        visits: 0,
        bounces: 0,
        totaltime: 0,
      };

      current.pageviews += Number(row.pageviews) || 0;
      current.visitors += Number(row.visitors) || 0;
      current.visits += Number(row.visits) || 0;
      current.bounces += Number(row.bounces) || 0;
      current.totaltime += Number(row.totaltime) || 0;

      merged.set(row.name, current);
    }
  }

  return Array.from(merged, ([name, totals]) => ({
    name,
    pageviews: String(totals.pageviews),
    visitors: totals.visitors,
    visits: totals.visits,
    bounces: totals.bounces,
    totaltime: String(totals.totaltime),
  }));
}

export function aggregateByEndpoint<T = unknown>(
  endpoint: ALLOWED_ENDPOINT,
  responses: unknown[],
): T {
  if (responses.length === 1 && endpoint !== 'pageviews') {
    return responses[0] as T;
  }

  if (endpoint === 'pageviews') {
    const pageviewsResponses = responses as Array<{
      pageviews?: MetricEntry[];
    }>;
    return mergeMetricEntries(
      pageviewsResponses.map((r) => r?.pageviews ?? []),
    ) as unknown as T;
  }

  if (endpoint === 'stats') {
    return mergeStats(responses as Partial<Stats>[]) as unknown as T;
  }

  if (endpoint === 'events/series') {
    return mergeMetricEntries(responses as MetricEntry[][]) as unknown as T;
  }

  if (endpoint === 'event-data/values') {
    const merged = new Map<string, number>();

    for (const response of responses as UmamiEventDataValue[][]) {
      for (const row of response ?? []) {
        const value = String(row?.value ?? '').trim();
        if (!value) continue;
        merged.set(value, (merged.get(value) ?? 0) + (Number(row?.total) || 0));
      }
    }

    const values = Array.from(merged, ([value, total]) => ({ value, total }));
    values.sort((a, b) => b.total - a.total);
    return values as unknown as T;
  }

  if (endpoint === 'metrics/expanded') {
    return mergeMetricsExpanded(
      responses as MetricsExpandedEntry[][],
    ) as unknown as T;
  }

  if (endpoint === 'sessions') {
    return {
      data: (responses as Array<{ data?: UmamiSession[] }>).flatMap(
        (r) => r?.data ?? [],
      ),
    } as unknown as T;
  }

  if (endpoint === 'event-data-pivot') {
    const allRows: UmamiEventDataPivotRow[] = [];
    let totalCount = 0;
    let page = 1;
    let pageSize = 100;

    for (const response of responses as UmamiEventDataPivotResponse[]) {
      if (response?.data) {
        allRows.push(...response.data);
      }
      totalCount += Number(response?.count) || 0;
      if (response?.page) {
        page = response.page;
      }
      if (response?.pageSize) {
        pageSize = response.pageSize;
      }
    }

    return {
      data: allRows,
      count: totalCount,
      page,
      pageSize,
    } as unknown as T;
  }

  return responses[0] as T;
}
