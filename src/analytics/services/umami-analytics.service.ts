import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
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
import { GeocodingService } from '../../geocoding/geocoding.service';
import { GeocodingProvider } from '../../geocoding/dto/geocoding.dto';
import {
  ExportSearchDataResponse,
  SearchEventExportRow,
} from '../dto/export-search-data-response.dto';
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
  UmamiEventDataPivotResponse,
  UmamiEventDataPivotRow,
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

export type ExportSearchDataInput = AnalyticsInput;

@Injectable()
export class UmamiAnalyticsService {
  private readonly logger = new Logger(UmamiAnalyticsService.name);

  constructor(
    private readonly umamiHttpService: UmamiHttpService,
    private readonly resourceService: ResourceService,
    private readonly analyticsCacheService: AnalyticsCacheService,
    private readonly geocodingService: GeocodingService,
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

  async getExportSearchData(
    input: ExportSearchDataInput,
  ): Promise<ExportSearchDataResponse> {
    const { startMs, endMs } = resolveTimeWindow(input.start, input.end);

    // return this.analyticsCacheService.getOrSet(
    //   input.tenantId,
    //   'export-search-data',
    //   input.websiteIds,
    //   startMs,
    //   endMs,
    //   async () => {
    const eventTypeByName: Record<string, 'text' | 'taxonomy'> = {
      search_text: 'text',
      search_taxonomy: 'taxonomy',
    };

    const taggedRows: Array<{
      row: UmamiEventDataPivotRow;
      queryType: 'text' | 'taxonomy';
    }> = [];

    for (const [eventName, queryType] of Object.entries(eventTypeByName)) {
      const rows = await this.fetchAllPivotRows(
        input.websiteIds,
        startMs,
        endMs,
        eventName,
      );
      for (const row of rows) {
        taggedRows.push({ row, queryType });
      }
    }

    const data: SearchEventExportRow[] = [];
    const batchSize = 10;

    for (let i = 0; i < taggedRows.length; i += batchSize) {
      const batch = taggedRows.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(({ row, queryType }) => this.toExportRow(row, queryType)),
      );
      for (const result of results) {
        if (result) data.push(result);
      }
    }

    return {
      data,
      totalCount: data.length,
    };
  }

  /**
   * Fetches every page of pivoted event data for a given event name across
   * the requested websites, since this endpoint intentionally has no
   * client-facing pagination.
   */
  private async fetchAllPivotRows(
    websiteIds: string[],
    startMs: number,
    endMs: number,
    eventName: string,
  ): Promise<UmamiEventDataPivotRow[]> {
    const pageSize = 1000;
    const rows: UmamiEventDataPivotRow[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      const responses =
        await this.umamiHttpService.fanOut<UmamiEventDataPivotResponse>(
          websiteIds,
          'event-data-pivot',
          {
            startAt: startMs,
            endAt: endMs,
            eventName,
            page,
            pageSize,
          },
        );

      const aggregated = aggregateByEndpoint<UmamiEventDataPivotResponse>(
        'event-data-pivot',
        responses,
      );

      if (aggregated?.data) {
        rows.push(...aggregated.data);
      }

      if (page === 1) {
        totalPages = Math.max(
          1,
          Math.ceil((aggregated?.count ?? 0) / pageSize),
        );
      }

      page++;
    } while (page <= totalPages);

    return rows;
  }

  private getPivotPropertyValue(
    row: UmamiEventDataPivotRow,
    key: string,
  ): string | null {
    const idx = row.propertyKeys.indexOf(key);
    return idx >= 0 ? row.propertyValues[idx] : null;
  }

  private async toExportRow(
    row: UmamiEventDataPivotRow,
    queryType: 'text' | 'taxonomy',
  ): Promise<SearchEventExportRow | null> {
    try {
      const queryLabel = this.getPivotPropertyValue(row, 'queryLabel');
      if (!queryLabel) {
        this.logger.debug(`Skipping event ${row.eventId}: missing queryLabel`);
        return null;
      }

      const userCoords = this.getPivotPropertyValue(row, 'userCoordinates');
      const searchCoords = this.getPivotPropertyValue(row, 'searchCoordinates');
      const coordinates = userCoords || searchCoords;

      let zipCode: string | null = null;
      if (coordinates) {
        zipCode = await this.reverseGeocodeToZipCode(coordinates, row.eventId);
      }

      const timestamp = new Date(row.createdAt).toISOString();

      return {
        timestamp,
        queryLabel,
        queryType,
        coordinates,
        zipCode,
      };
    } catch (error) {
      this.logger.error(
        `Failed to process event ${row.eventId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return null;
    }
  }

  private async reverseGeocodeToZipCode(
    coordinates: string,
    eventId: string,
  ): Promise<string | null> {
    try {
      const parts = coordinates.split(',').map((s) => s.trim());
      if (parts.length !== 2) {
        this.logger.warn(
          `Invalid coordinates format for event ${eventId}: ${coordinates}`,
        );
        return null;
      }

      const [lng, lat] = parts.map(Number);

      if (isNaN(lat) || isNaN(lng)) {
        this.logger.warn(
          `Invalid coordinate values for event ${eventId}: ${coordinates}`,
        );
        return null;
      }

      const results = await this.geocodingService.reverseGeocode({
        coordinates: [lng, lat],
        provider: GeocodingProvider.OPENCAGE,
      });

      if (results && results.length > 0 && results[0].postcode) {
        return results[0].postcode;
      }

      this.logger.debug(
        `No postcode found for event ${eventId} at coordinates ${coordinates}`,
      );

      return null;
    } catch (error) {
      this.logger.warn(
        `Geocoding failed for event ${eventId} at ${coordinates}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return null;
    }
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
