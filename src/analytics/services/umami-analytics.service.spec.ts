import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UmamiAnalyticsService } from './umami-analytics.service';
import { UmamiHttpService } from './umami-http.service';
import { AnalyticsCacheService } from './analytics-cache.service';
import { ResourceService } from '../../resource/resource.service';
import { GeocodingService } from '../../geocoding/geocoding.service';
import type { UmamiEventDataPivotRow } from '../types/umami/umami-event-data-pivot';

describe('UmamiAnalyticsService', () => {
  let service: UmamiAnalyticsService;

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
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UmamiAnalyticsService,
        { provide: UmamiHttpService, useValue: {} },
        { provide: ResourceService, useValue: {} },
        { provide: AnalyticsCacheService, useValue: {} },
        { provide: GeocodingService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get(UmamiAnalyticsService);
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
