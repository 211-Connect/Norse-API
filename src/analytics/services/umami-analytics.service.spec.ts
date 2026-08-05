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
  });
});
