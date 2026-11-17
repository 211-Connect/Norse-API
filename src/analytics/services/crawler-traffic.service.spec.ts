import { BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';

import { CrawlerTrafficHourly } from '../../common/schemas/crawler-traffic-hourly.schema';
import { CrawlerTrafficService } from './crawler-traffic.service';

const TENANT = '7f4c2a51-0c7e-4b8e-9d0a-2f8a3b1c9e10';
const NOW = Date.parse('2026-11-17T14:25:00.000Z');

describe('CrawlerTrafficService', () => {
  let service: CrawlerTrafficService;

  const mockBulkWrite = jest.fn();
  const mockAggregateExec = jest.fn();
  const mockAggregate = jest.fn();
  const mockModel = { bulkWrite: mockBulkWrite, aggregate: mockAggregate };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAggregate.mockReturnValue({ exec: mockAggregateExec });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CrawlerTrafficService,
        {
          provide: getModelToken(CrawlerTrafficHourly.name),
          useValue: mockModel,
        },
      ],
    }).compile();

    service = module.get(CrawlerTrafficService);
  });

  describe('record', () => {
    it('$inc-upserts each bucket and merges duplicates within a push', async () => {
      const recorded = await service.record(
        TENANT,
        [
          {
            hour: '2026-11-17T14:00:00.000Z',
            crawler: 'AHREFS_CRAWLER',
            outcome: 'blocked',
            classification: 'seo',
            count: 3,
          },
          {
            hour: '2026-11-17T14:00:00.000Z',
            crawler: 'AHREFS_CRAWLER',
            outcome: 'blocked',
            classification: 'seo',
            count: 2,
          },
          {
            hour: '2026-11-17T14:00:00.000Z',
            crawler: '',
            outcome: 'shed',
            classification: 'unknown',
            count: 7,
          },
        ],
        NOW,
      );

      expect(recorded).toBe(12);
      expect(mockBulkWrite).toHaveBeenCalledWith(
        [
          {
            updateOne: {
              filter: {
                tenantId: TENANT,
                hour: new Date('2026-11-17T14:00:00.000Z'),
                crawler: 'AHREFS_CRAWLER',
                outcome: 'blocked',
                classification: 'seo',
              },
              update: { $inc: { count: 5 } },
              upsert: true,
            },
          },
          {
            updateOne: {
              filter: {
                tenantId: TENANT,
                hour: new Date('2026-11-17T14:00:00.000Z'),
                crawler: '',
                outcome: 'shed',
                classification: 'unknown',
              },
              update: { $inc: { count: 7 } },
              upsert: true,
            },
          },
        ],
        { ordered: false },
      );
    });

    it.each([
      ['not on the hour', '2026-11-17T14:30:00.000Z'],
      ['in the future', '2026-11-17T16:00:00.000Z'],
      ['older than 7 days', '2026-11-09T14:00:00.000Z'],
    ])('rejects a bucket %s', async (_label, hour) => {
      await expect(
        service.record(
          TENANT,
          [
            {
              hour,
              crawler: '',
              outcome: 'shed',
              classification: 'unknown',
              count: 1,
            },
          ],
          NOW,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockBulkWrite).not.toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('matches the tenant from the start hour and maps the facets', async () => {
      mockAggregateExec.mockResolvedValue([
        {
          totals: [
            {
              _id: null,
              blocked: 5,
              logged: 1,
              rateLimited: 2,
              allowed: 9,
              shed: 0,
              total: 17,
            },
          ],
          byCrawler: [
            {
              _id: { crawler: 'GOOGLE_CRAWLER', classification: 'unknown' },
              blocked: 0,
              logged: 0,
              rateLimited: 0,
              allowed: 9,
              shed: 0,
              total: 9,
            },
          ],
          series: [
            {
              _id: new Date('2026-11-17T00:00:00.000Z'),
              blocked: 5,
              logged: 1,
              rateLimited: 2,
              allowed: 9,
              shed: 0,
              total: 17,
            },
          ],
        },
      ]);

      const result = await service.getStats(
        TENANT,
        '2026-11-17T00:30:00Z',
        '2026-11-17T13:59:59Z',
      );

      const pipeline = mockAggregate.mock.calls[0][0];
      expect(pipeline[0]).toEqual({
        $match: {
          tenantId: TENANT,
          hour: {
            $gte: new Date('2026-11-17T00:00:00.000Z'),
            $lte: new Date('2026-11-17T13:59:59.000Z'),
          },
        },
      });
      expect(pipeline[1].$facet.byTenant).toBeUndefined();
      expect(result).toEqual({
        granularity: 'day',
        totals: {
          blocked: 5,
          logged: 1,
          rateLimited: 2,
          allowed: 9,
          shed: 0,
          total: 17,
        },
        byCrawler: [
          {
            crawler: 'GOOGLE_CRAWLER',
            classification: 'unknown',
            blocked: 0,
            logged: 0,
            rateLimited: 0,
            allowed: 9,
            shed: 0,
            total: 9,
          },
        ],
        series: [
          {
            bucket: '2026-11-17T00:00:00.000Z',
            blocked: 5,
            logged: 1,
            rateLimited: 2,
            allowed: 9,
            shed: 0,
            total: 17,
          },
        ],
      });
    });

    it('returns zeros when nothing was counted', async () => {
      mockAggregateExec.mockResolvedValue([
        { totals: [], byCrawler: [], series: [] },
      ]);
      const result = await service.getStats(
        TENANT,
        '2026-11-17T00:00:00Z',
        '2026-11-17T13:00:00Z',
        'hour',
      );
      expect(result.totals.total).toBe(0);
      expect(result.series).toEqual([]);
    });

    it('rejects hourly granularity over more than 31 days', async () => {
      await expect(
        service.getStats(
          TENANT,
          '2026-09-01T00:00:00Z',
          '2026-11-01T00:00:00Z',
          'hour',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockAggregate).not.toHaveBeenCalled();
    });
  });

  describe('getAllTenantsStats', () => {
    it('reads every tenant and adds the per-tenant breakdown', async () => {
      mockAggregateExec.mockResolvedValue([
        {
          totals: [],
          byCrawler: [],
          series: [],
          byTenant: [
            {
              _id: TENANT,
              blocked: 1,
              logged: 0,
              rateLimited: 0,
              allowed: 0,
              shed: 4,
              total: 5,
            },
          ],
        },
      ]);

      const result = await service.getAllTenantsStats(
        '2026-11-17T00:00:00Z',
        '2026-11-17T13:00:00Z',
      );

      const pipeline = mockAggregate.mock.calls[0][0];
      expect(pipeline[0].$match.tenantId).toBeUndefined();
      expect(result.byTenant).toEqual([
        {
          tenantId: TENANT,
          blocked: 1,
          logged: 0,
          rateLimited: 0,
          allowed: 0,
          shed: 4,
          total: 5,
        },
      ]);
    });
  });
});
