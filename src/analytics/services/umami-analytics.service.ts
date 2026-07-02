import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';

import { aggregateByEndpoint } from '../internal/aggregators';
import {
  parseMetrics,
  sumEventTotals,
  toMetricEntries,
} from '../internal/parsers';
import { timeWindow } from '../internal/period';
import { UmamiEvent } from '../internal/umami-events';
import { isSearchQueryType } from '../internal/search-query-type';
import { UmamiHttpService } from './umami-http.service';
import { AnalyticsCacheService } from './analytics-cache.service';
import { ResourceService } from '../../resource/resource.service';
import type { TimeWindow } from '../internal/period';
import type {
  AnalyticsMetrics,
  LanguageSwitch,
  MetricsExpandedEntry,
  PageviewEntry,
  PaginatedSessions,
  ResourceByEntry,
  ResourceMetric,
  Searches,
  SearchHits,
  SearchQueryType,
  Stats,
  UmamiBatchResponse,
  UmamiEventDataValue,
  UmamiEventPayload,
  UmamiSendResponse,
  UmamiSessionResponse,
  ZeroResultQuery,
} from '../types';

const SEARCH_RESOURCE_PREFIX = '/search/';

function toSortedEntries(map: Map<string, number>): SearchHits[] {
  return Array.from(map, ([x, y]) => ({ query: x, hits: y })).sort(
    (a, b) => b.hits - a.hits,
  );
}

function extractResourceId(path: string): string | null {
  const idx = path.indexOf(SEARCH_RESOURCE_PREFIX);
  if (idx === -1) return null;
  const id = path.slice(idx + SEARCH_RESOURCE_PREFIX.length);
  return id.length > 0 ? id : null;
}

function resolveTimeWindow(start: string, end: string): TimeWindow {
  const result = timeWindow(start, end);
  if (result.success === false) {
    throw new BadRequestException(result.error);
  }
  return result.timeWindow;
}

export interface AnalyticsInput {
  tenantId: string;
  start: string;
  end: string;
  websiteIds: string[];
}

export interface PageviewsInput extends AnalyticsInput {
  unit: string;
  timezone: string;
}

export interface TimezoneInput extends AnalyticsInput {
  timezone: string;
}

export interface SessionsInput extends AnalyticsInput {
  page: number;
  limit: number;
}

@Injectable()
export class UmamiAnalyticsService {
  constructor(
    private readonly umamiHttpService: UmamiHttpService,
    private readonly resourceService: ResourceService,
    private readonly analyticsCacheService: AnalyticsCacheService,
  ) {}

  async getStats(input: AnalyticsInput): Promise<Stats> {
    const { startMs, endMs } = resolveTimeWindow(input.start, input.end);
    return this.analyticsCacheService.getOrSet(
      input.tenantId,
      'stats',
      input.websiteIds,
      startMs,
      endMs,
      async () => {
        const responses = await this.umamiHttpService.fanOut(
          input.websiteIds,
          'stats',
          { startAt: startMs, endAt: endMs },
        );
        return aggregateByEndpoint<Stats>('stats', responses);
      },
    );
  }

  async getPageviews(input: PageviewsInput): Promise<PageviewEntry[]> {
    const { startMs, endMs } = resolveTimeWindow(input.start, input.end);
    return this.analyticsCacheService.getOrSet(
      input.tenantId,
      'pageviews',
      input.websiteIds,
      startMs,
      endMs,
      async () => {
        const responses = await this.umamiHttpService.fanOut(
          input.websiteIds,
          'pageviews',
          {
            startAt: startMs,
            endAt: endMs,
            unit: input.unit,
            timezone: input.timezone,
          },
        );
        return aggregateByEndpoint<{ x: string; y: number }[]>(
          'pageviews',
          responses,
        ).map(({ x, y }) => ({ date: x, hits: y }));
      },
      input.timezone,
    );
  }

  async getMetrics(input: TimezoneInput): Promise<AnalyticsMetrics> {
    const { startMs, endMs } = resolveTimeWindow(input.start, input.end);
    return this.analyticsCacheService.getOrSet(
      input.tenantId,
      'metrics',
      input.websiteIds,
      startMs,
      endMs,
      async () => {
        const [pathRes, queryRes, eventsRes] = await Promise.all([
          this.umamiHttpService.fanOut<MetricsExpandedEntry[]>(
            input.websiteIds,
            'metrics/expanded',
            { startAt: startMs, endAt: endMs, type: 'path' },
          ),
          this.umamiHttpService.fanOut<MetricsExpandedEntry[]>(
            input.websiteIds,
            'metrics/expanded',
            { startAt: startMs, endAt: endMs, type: 'query' },
          ),
          this.umamiHttpService.fanOut<{ x: string; y: number }[]>(
            input.websiteIds,
            'events/series',
            { startAt: startMs, endAt: endMs, timezone: input.timezone },
          ),
        ]);

        const pathMetrics = aggregateByEndpoint<MetricsExpandedEntry[]>(
          'metrics/expanded',
          pathRes,
        );
        const queryMetrics = aggregateByEndpoint<MetricsExpandedEntry[]>(
          'metrics/expanded',
          queryRes,
        );
        const events = aggregateByEndpoint<{ x: string; y: number }[]>(
          'events/series',
          eventsRes,
        );

        const eventTotals = sumEventTotals(events);
        const { searchCount, resourceMetrics } = parseMetrics(
          pathMetrics,
          queryMetrics,
        );

        const sumY = (entries: { y: number }[]) =>
          entries.reduce((sum, e) => sum + (Number(e?.y) || 0), 0);

        return {
          searches: searchCount,
          resourceViews: sumY(resourceMetrics),
          zeroResults: eventTotals[UmamiEvent.SearchZeroResults] ?? 0,
          directions: eventTotals[UmamiEvent.DirectionClick] ?? 0,
          phoneCalls: eventTotals[UmamiEvent.PhoneClick] ?? 0,
          websiteClicks: eventTotals[UmamiEvent.WebsiteClick] ?? 0,
          widgetSearches: eventTotals[UmamiEvent.WidgetSearch] ?? 0,
          calloutClicks: eventTotals[UmamiEvent.CalloutClick] ?? 0,
          languageSwitches: eventTotals[UmamiEvent.LanguageSwitch] ?? 0,
          resourceViewed: eventTotals[UmamiEvent.ResourceViewed] ?? 0,
        };
      },
      input.timezone,
    );
  }

  async getResourceMetrics(input: AnalyticsInput): Promise<ResourceMetric[]> {
    const { startMs, endMs } = resolveTimeWindow(input.start, input.end);
    return this.analyticsCacheService.getOrSet(
      input.tenantId,
      'resource-metrics',
      input.websiteIds,
      startMs,
      endMs,
      async () => {
        const pathRes = await this.umamiHttpService.fanOut<
          MetricsExpandedEntry[]
        >(input.websiteIds, 'metrics/expanded', {
          startAt: startMs,
          endAt: endMs,
          type: 'path',
        });

        const pathMetrics = aggregateByEndpoint<MetricsExpandedEntry[]>(
          'metrics/expanded',
          pathRes,
        );

        const { resourceMetrics } = parseMetrics(pathMetrics, []);
        const resourceIdsViewMap = resourceMetrics
          .map((row) => ({ id: extractResourceId(row.x), views: row.y }))
          .filter((id): id is { id: string; views: number } => id.id !== null);

        if (resourceIdsViewMap.length === 0) {
          return [];
        }

        const resourceIds = resourceIdsViewMap.map((item) => item.id);
        const resourceTitles =
          await this.resourceService.findTitlesByIds(resourceIds);

        const titleMap = new Map(
          resourceTitles.map((item) => [item.id, item.displayName]),
        );

        return resourceIdsViewMap.map((item) => ({
          title: titleMap.get(item.id) ?? item.id,
          views: item.views,
        }));
      },
    );
  }

  async getSearches(input: AnalyticsInput): Promise<Searches> {
    const { startMs, endMs } = resolveTimeWindow(input.start, input.end);
    return this.analyticsCacheService.getOrSet(
      input.tenantId,
      'searches',
      input.websiteIds,
      startMs,
      endMs,
      async () => {
        const queryRes = await this.umamiHttpService.fanOut<
          MetricsExpandedEntry[]
        >(input.websiteIds, 'metrics/expanded', {
          startAt: startMs,
          endAt: endMs,
          type: 'query',
        });

        const queryMetrics = aggregateByEndpoint<MetricsExpandedEntry[]>(
          'metrics/expanded',
          queryRes,
        );

        const labelByTypeMaps: Record<SearchQueryType, Map<string, number>> = {
          text: new Map<string, number>(),
          taxonomy: new Map<string, number>(),
          hybrid: new Map<string, number>(),
        };

        for (const queryMetric of queryMetrics) {
          const params = new URLSearchParams(queryMetric.name);
          const label = params.get('query_label');
          if (label === null) continue;
          const rawType = params.get('query_type');
          if (!isSearchQueryType(rawType)) continue;
          const hits = Number(queryMetric.pageviews) || 0;
          const bucket = labelByTypeMaps[rawType];
          bucket.set(label, (bucket.get(label) ?? 0) + hits);
        }

        return {
          text: toSortedEntries(labelByTypeMaps.text),
          taxonomy: toSortedEntries(labelByTypeMaps.taxonomy),
          hybrid: toSortedEntries(labelByTypeMaps.hybrid),
        };
      },
    );
  }

  async getZeroResultQueries(
    input: AnalyticsInput,
  ): Promise<ZeroResultQuery[]> {
    const { startMs, endMs } = resolveTimeWindow(input.start, input.end);
    return this.analyticsCacheService.getOrSet(
      input.tenantId,
      'zero-result-queries',
      input.websiteIds,
      startMs,
      endMs,
      async () => {
        const responses = await this.umamiHttpService.fanOut<
          UmamiEventDataValue[]
        >(input.websiteIds, 'event-data/values', {
          startAt: startMs,
          endAt: endMs,
          event: UmamiEvent.SearchZeroResults,
          propertyName: 'query',
        });

        const aggregated = aggregateByEndpoint<UmamiEventDataValue[]>(
          'event-data/values',
          responses,
        );
        return toMetricEntries(aggregated).map(({ x, y }) => ({
          query: x,
          hits: y,
        }));
      },
    );
  }

  async getLanguageSwitches(input: AnalyticsInput): Promise<LanguageSwitch[]> {
    const { startMs, endMs } = resolveTimeWindow(input.start, input.end);
    return this.analyticsCacheService.getOrSet(
      input.tenantId,
      'language-switches',
      input.websiteIds,
      startMs,
      endMs,
      async () => {
        const responses = await this.umamiHttpService.fanOut<
          UmamiEventDataValue[]
        >(input.websiteIds, 'event-data/values', {
          startAt: startMs,
          endAt: endMs,
          event: UmamiEvent.LanguageSwitch,
          propertyName: 'destinationLanguage',
        });

        const aggregated = aggregateByEndpoint<UmamiEventDataValue[]>(
          'event-data/values',
          responses,
        );
        return toMetricEntries(aggregated).map(({ x, y }) => ({
          language: x,
          count: y,
        }));
      },
    );
  }

  async getResourceByEntry(input: AnalyticsInput): Promise<ResourceByEntry[]> {
    const { startMs, endMs } = resolveTimeWindow(input.start, input.end);
    return this.analyticsCacheService.getOrSet(
      input.tenantId,
      'resource-by-entry',
      input.websiteIds,
      startMs,
      endMs,
      async () => {
        const responses = await this.umamiHttpService.fanOut<
          UmamiEventDataValue[]
        >(input.websiteIds, 'event-data/values', {
          startAt: startMs,
          endAt: endMs,
          event: UmamiEvent.ResourceViewed,
          propertyName: 'entry',
        });

        const aggregated = aggregateByEndpoint<UmamiEventDataValue[]>(
          'event-data/values',
          responses,
        );
        return toMetricEntries(aggregated).map(({ x, y }) => ({
          entry: x,
          count: y,
        }));
      },
    );
  }

  async getSessions(input: SessionsInput): Promise<PaginatedSessions> {
    const { startMs, endMs } = resolveTimeWindow(input.start, input.end);
    const cacheExtra = `page:${input.page}:limit:${input.limit}`;

    return this.analyticsCacheService.getOrSet(
      input.tenantId,
      'sessions',
      input.websiteIds,
      startMs,
      endMs,
      async () => {
        const responses =
          await this.umamiHttpService.fanOut<UmamiSessionResponse>(
            input.websiteIds,
            'sessions',
            {
              startAt: startMs,
              endAt: endMs,
              page: input.page,
              pageSize: input.limit,
            },
          );
        const aggregated = aggregateByEndpoint<UmamiSessionResponse>(
          'sessions',
          responses,
        );
        if (!aggregated || !Array.isArray(aggregated.data)) {
          throw new HttpException(
            'Failed to reach Umami API: malformed sessions response',
            HttpStatus.BAD_GATEWAY,
          );
        }
        const data = aggregated.data;
        return {
          page: input.page,
          limit: input.limit,
          count: data.length,
          data,
        };
      },
      undefined,
      cacheExtra,
    );
  }

  async sendEvent(
    websiteId: string,
    input: SendEventInput,
  ): Promise<UmamiSendResponse> {
    return this.umamiHttpService.sendEvent(
      websiteId,
      toUmamiEventPayload(input),
    );
  }

  async sendBatch(
    events: Array<{ websiteId: string; input: SendEventInput }>,
  ): Promise<UmamiBatchResponse> {
    return this.umamiHttpService.sendBatch(
      events.map((event) => ({
        websiteId: event.websiteId,
        payload: toUmamiEventPayload(event.input),
      })),
    );
  }
}

export interface SendEventInput {
  name: string;
  data?: Record<string, unknown>;
  timestamp?: string;
}

function toUmamiEventPayload(input: SendEventInput): UmamiEventPayload {
  return {
    name: input.name,
    data: input.data,
    ...(input.timestamp && {
      timestamp: Math.floor(new Date(input.timestamp).getTime() / 1000),
    }),
  };
}
