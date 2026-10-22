import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UmamiAnalyticsService } from './umami-analytics.service';
import { UmamiHttpService } from './umami-http.service';
import { AnalyticsCacheService } from './analytics-cache.service';
import { ResourceService } from '../../resource/resource.service';
import { GeocodingService } from '../../geocoding/geocoding.service';
import { UmamiEvent } from '../internal/umami-events';
import type { UmamiEventDataPivotRow } from '../types/umami/umami-event-data-pivot';

describe('UmamiAnalyticsService', () => {
  let service: UmamiAnalyticsService;
  let umamiHttpService: { fanOut: jest.Mock };
  let analyticsCacheService: { getOrSet: jest.Mock };

  const buildRow = (
    properties: Record<string, string>,
  ): UmamiEventDataPivotRow => ({
    eventId: 'event-1',
    websiteId: 'website-1',
    createdAt: Date.parse('2025-01-15T14:23:45.000Z'),
    propertyKeys: Object.keys(properties),
    propertyValues: Object.values(properties),
  });

  beforeEach(async () => {
    umamiHttpService = { fanOut: jest.fn() };
    analyticsCacheService = {
      getOrSet: jest.fn((_tenantId, _key, _websiteIds, _startMs, _endMs, fn) =>
        fn(),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UmamiAnalyticsService,
        { provide: UmamiHttpService, useValue: umamiHttpService },
        { provide: ResourceService, useValue: {} },
        { provide: AnalyticsCacheService, useValue: analyticsCacheService },
        { provide: GeocodingService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn(() => []) } },
      ],
    }).compile();

    service = module.get(UmamiAnalyticsService);
  });

  describe('getMetrics', () => {
    it('maps each Umami event total to the correct AnalyticsMetrics field', async () => {
      const eventSeries = [
        { x: UmamiEvent.SearchZeroResults, y: 1 },
        { x: UmamiEvent.DirectionClick, y: 2 },
        { x: UmamiEvent.PhoneClick, y: 3 },
        { x: UmamiEvent.WebsiteClick, y: 4 },
        { x: UmamiEvent.SmsClick, y: 5 },
        { x: UmamiEvent.WidgetSearch, y: 6 },
        { x: UmamiEvent.CalloutClick, y: 7 },
        { x: UmamiEvent.LanguageSwitch, y: 8 },
        { x: UmamiEvent.ResourceViewed, y: 9 },
        { x: UmamiEvent.SafeExitClick, y: 10 },
        { x: UmamiEvent.FavoriteAddToList, y: 11 },
        { x: UmamiEvent.HighlightClick, y: 12 },
        { x: UmamiEvent.AlertClick, y: 13 },
      ];

      umamiHttpService.fanOut.mockImplementation((_websiteIds, endpoint) => {
        if (endpoint === 'events/series') {
          return Promise.resolve([eventSeries]);
        }
        // metrics/expanded (path + query)
        return Promise.resolve([[]]);
      });

      const result = await service.getMetrics({
        tenantId: 'tenant-1',
        start: '2025-01-01T00:00:00.000Z',
        end: '2025-01-02T00:00:00.000Z',
        websiteIds: ['website-1'],
        timezone: 'UTC',
      });

      expect(result).toEqual({
        searches: 0,
        resourceViews: 0,
        zeroResults: 1,
        directions: 2,
        phoneCalls: 3,
        websiteClicks: 4,
        smsClicks: 5,
        widgetSearches: 6,
        calloutClicks: 7,
        languageSwitches: 8,
        resourceViewed: 9,
        safeExitClicks: 10,
        favoriteAddToList: 11,
        highlightClicks: 12,
        alertClicks: 13,
      });
    });

    it('defaults every metric to 0 when there are no events', async () => {
      umamiHttpService.fanOut.mockResolvedValue([[]]);

      const result = await service.getMetrics({
        tenantId: 'tenant-1',
        start: '2025-01-01T00:00:00.000Z',
        end: '2025-01-02T00:00:00.000Z',
        websiteIds: ['website-1'],
        timezone: 'UTC',
      });

      expect(result.smsClicks).toBe(0);
      expect(result.phoneCalls).toBe(0);
    });
  });

  describe('toExportRow', () => {
    const invoke = (
      row: UmamiEventDataPivotRow,
      queryType: 'text' | 'taxonomy' = 'text',
    ) =>
      (
        service as unknown as {
          toExportRow: (
            row: UmamiEventDataPivotRow,
            queryType: 'text' | 'taxonomy',
          ) => Promise<unknown>;
        }
      ).toExportRow(row, queryType);

    it('anonymizes userId and sessionId when present', async () => {
      const row = buildRow({
        queryLabel: 'homeless shelter',
        userId: 'raw-user-id',
        sessionId: 'raw-session-id',
      });

      const result = (await invoke(row)) as {
        userId: string | null;
        sessionId: string | null;
      };

      expect(result.userId).not.toBeNull();
      expect(result.userId).not.toBe('raw-user-id');
      expect(result.sessionId).not.toBeNull();
      expect(result.sessionId).not.toBe('raw-session-id');
    });

    it('produces the same hashed userId for the same raw value across rows', async () => {
      const rowA = buildRow({ queryLabel: 'a', userId: 'same-user' });
      const rowB = buildRow({ queryLabel: 'b', userId: 'same-user' });

      const resultA = (await invoke(rowA)) as { userId: string | null };
      const resultB = (await invoke(rowB)) as { userId: string | null };

      expect(resultA.userId).toBe(resultB.userId);
    });

    it('returns null for userId/sessionId when the properties are absent', async () => {
      const row = buildRow({ queryLabel: 'no ids here' });

      const result = (await invoke(row)) as {
        userId: string | null;
        sessionId: string | null;
      };

      expect(result.userId).toBeNull();
      expect(result.sessionId).toBeNull();
    });

    it('returns null when queryLabel is missing', async () => {
      const row = buildRow({ userId: 'raw-user-id' });

      const result = await invoke(row);

      expect(result).toBeNull();
    });

    it('extracts referralSource from the utm_source property when present', async () => {
      const row = buildRow({
        queryLabel: 'homeless shelter',
        utm_source: 'google',
      });

      const result = (await invoke(row)) as { referralSource: string | null };

      expect(result.referralSource).toBe('google');
    });

    it('returns null for referralSource when utm_source is absent', async () => {
      const row = buildRow({ queryLabel: 'no utm here' });

      const result = (await invoke(row)) as { referralSource: string | null };

      expect(result.referralSource).toBeNull();
    });
  });

  describe('getSearches', () => {
    it('groups each search event value into hit counts', async () => {
      umamiHttpService.fanOut.mockImplementation(
        async (
          _websiteIds: string[],
          endpoint: string,
          params: { event?: string },
        ) => {
          if (endpoint !== 'event-data/values') return [[]];

          if (params.event === 'search_text') {
            return [
              [
                { value: 'food', total: 7 },
                { value: 'rent', total: 3 },
              ],
              [{ value: 'food', total: 1 }],
            ];
          }
          if (params.event === 'search_taxonomy') {
            return [
              [{ value: 'Housing', total: 4 }],
              [{ value: 'Housing', total: 2 }],
            ];
          }
          return [
            [{ value: 'Transit', total: 5 }],
            [{ value: 'Transit', total: 2 }],
          ];
        },
      );

      const result = await service.getSearches({
        tenantId: 'tenant-1',
        start: '2026-09-30T00:00:00.000Z',
        end: '2026-10-01T00:00:00.000Z',
        websiteIds: ['website-1', 'website-2'],
      });

      expect(result).toEqual({
        text: [
          { query: 'food', hits: 8 },
          { query: 'rent', hits: 3 },
        ],
        taxonomy: [{ query: 'Housing', hits: 6 }],
        hybrid: [{ query: 'Transit', hits: 7 }],
      });
    });
  });

  describe('getAreaSearches', () => {
    it('counts hybrid search events in area totals alongside text and taxonomy', async () => {
      const rowsByEvent: Record<string, UmamiEventDataPivotRow[]> = {
        search_text: [
          buildRow({ searchZipCode: '10001' }),
          buildRow({ searchZipCode: '10001' }),
        ],
        search_taxonomy: [buildRow({ searchZipCode: '10002' })],
        search_hybrid: [
          buildRow({ searchZipCode: '10001' }),
          buildRow({ searchZipCode: '10001' }),
        ],
        search_zero_results: [buildRow({ searchZipCode: '10001' })],
      };

      umamiHttpService.fanOut.mockImplementation(
        async (
          _websiteIds: string[],
          endpoint: string,
          params: { eventName: string },
        ) => {
          if (endpoint !== 'event-data-pivot') return [[]];
          const rows = rowsByEvent[params.eventName] ?? [];
          return [{ data: rows, count: rows.length }];
        },
      );

      const result = await service.getAreaSearches({
        tenantId: 'tenant-1',
        start: '2026-09-30T00:00:00.000Z',
        end: '2026-10-01T00:00:00.000Z',
        websiteIds: ['website-1'],
      });

      expect(result.zipCodeRows).toEqual([
        { area: '10001', totalSearches: 5, zeroSearches: 1, zeroRate: 0.2 },
        { area: '10002', totalSearches: 1, zeroSearches: 0, zeroRate: 0 },
      ]);
      expect(result.countyRows).toEqual([]);
    });

    it('drops rows without any area property', async () => {
      umamiHttpService.fanOut.mockImplementation(async () => [
        { data: [buildRow({})], count: 1 },
      ]);

      const result = await service.getAreaSearches({
        tenantId: 'tenant-1',
        start: '2026-09-30T00:00:00.000Z',
        end: '2026-10-01T00:00:00.000Z',
        websiteIds: ['website-1'],
      });

      expect(result.zipCodeRows).toEqual([]);
      expect(result.countyRows).toEqual([]);
    });
  });

  describe('getExportSearchData', () => {
    it('includes all rows when Umami returns a smaller page size than requested', async () => {
      const eventCounts: Record<string, number> = {
        search_text: 250,
        search_taxonomy: 150,
      };
      const actualPageSize = 100;

      umamiHttpService.fanOut.mockImplementation(
        async (
          _websiteIds: string[],
          _endpoint: string,
          params: { eventName: string; page: number },
        ) => {
          const count = eventCounts[params.eventName];
          const offset = (params.page - 1) * actualPageSize;
          const pageCount = Math.max(
            0,
            Math.min(actualPageSize, count - offset),
          );

          return [
            {
              count,
              page: params.page,
              pageSize: actualPageSize,
              data: Array.from({ length: pageCount }, (_, index) =>
                buildRow({
                  queryLabel: `${params.eventName}-${offset + index}`,
                }),
              ),
            },
          ];
        },
      );

      const result = await service.getExportSearchData({
        tenantId: 'tenant-1',
        start: '2026-09-30T00:00:00.000Z',
        end: '2026-10-01T00:00:00.000Z',
        websiteIds: ['website-1'],
      });

      expect(result.totalCount).toBe(400);
      expect(
        result.data.filter((row) => row.queryType === 'text'),
      ).toHaveLength(250);
      expect(
        result.data.filter((row) => row.queryType === 'taxonomy'),
      ).toHaveLength(150);
    });

    it('includes hybrid search events alongside text and taxonomy events', async () => {
      const eventCounts: Record<string, number> = {
        search_text: 2,
        search_taxonomy: 1,
        search_hybrid: 3,
      };

      umamiHttpService.fanOut.mockImplementation(
        async (
          _websiteIds: string[],
          _endpoint: string,
          params: { eventName: string },
        ) => [
          {
            count: eventCounts[params.eventName],
            page: 1,
            pageSize: 1000,
            data: Array.from(
              { length: eventCounts[params.eventName] },
              (_, index) =>
                buildRow({ queryLabel: `${params.eventName}-${index}` }),
            ),
          },
        ],
      );

      const result = await service.getExportSearchData({
        tenantId: 'tenant-1',
        start: '2026-09-30T00:00:00.000Z',
        end: '2026-10-01T00:00:00.000Z',
        websiteIds: ['website-1'],
      });

      expect(result.totalCount).toBe(6);
      expect(
        result.data.filter((row) => row.queryType === 'hybrid'),
      ).toHaveLength(3);
      expect(result.data).toContainEqual(
        expect.objectContaining({
          queryLabel: 'search_hybrid-0',
          queryType: 'hybrid',
        }),
      );
    });
  });
});
