import { BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';

import { BlockedTrafficHourly } from '../../common/schemas/blocked-traffic-hourly.schema';
import { BlockedTrafficService } from './blocked-traffic.service';

const TENANT = '7f4c2a51-0c7e-4b8e-9d0a-2f8a3b1c9e10';
const NOW = Date.parse('2026-10-22T14:25:00.000Z');

describe('BlockedTrafficService', () => {
  let service: BlockedTrafficService;

  const mockBulkWrite = jest.fn();
  const mockExec = jest.fn();
  const mockQuery = {
    sort: jest.fn(),
    lean: jest.fn(),
    exec: mockExec,
  };
  const mockFind = jest.fn();
  const mockAggregateExec = jest.fn();
  const mockAggregate = jest.fn();
  const mockModel = {
    bulkWrite: mockBulkWrite,
    find: mockFind,
    aggregate: mockAggregate,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockQuery.sort.mockReturnValue(mockQuery);
    mockQuery.lean.mockReturnValue(mockQuery);
    mockFind.mockReturnValue(mockQuery);
    mockAggregate.mockReturnValue({ exec: mockAggregateExec });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlockedTrafficService,
        {
          provide: getModelToken(BlockedTrafficHourly.name),
          useValue: mockModel,
        },
      ],
    }).compile();

    service = module.get(BlockedTrafficService);
  });

  describe('record', () => {
    it('$inc-upserts each bucket and merges duplicates within a push', async () => {
      const recorded = await service.record(
        TENANT,
        [
          {
            hour: '2026-10-22T14:00:00.000Z',
            classification: 'nefarious',
            enforced: true,
            count: 3,
          },
          {
            hour: '2026-10-22T14:00:00.000Z',
            classification: 'nefarious',
            enforced: true,
            count: 2,
          },
          {
            hour: '2026-10-22T13:00:00.000Z',
            classification: 'seo',
            enforced: false,
            count: 1,
          },
        ],
        NOW,
      );

      expect(recorded).toBe(6);
      expect(mockBulkWrite).toHaveBeenCalledWith(
        [
          {
            updateOne: {
              filter: {
                tenantId: TENANT,
                hour: new Date('2026-10-22T14:00:00.000Z'),
                classification: 'nefarious',
                enforced: true,
              },
              update: { $inc: { count: 5 } },
              upsert: true,
            },
          },
          {
            updateOne: {
              filter: {
                tenantId: TENANT,
                hour: new Date('2026-10-22T13:00:00.000Z'),
                classification: 'seo',
                enforced: false,
              },
              update: { $inc: { count: 1 } },
              upsert: true,
            },
          },
        ],
        { ordered: false },
      );
    });

    it.each([
      ['not on the hour', '2026-10-22T14:01:00.000Z'],
      ['in the future', '2026-10-22T16:00:00.000Z'],
      ['older than 7 days', '2026-10-15T13:00:00.000Z'],
    ])('rejects an hour %s and writes nothing', async (_label, hour) => {
      await expect(
        service.record(
          TENANT,
          [{ hour, classification: 'unknown', enforced: true, count: 1 }],
          NOW,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockBulkWrite).not.toHaveBeenCalled();
    });

    it('accepts the current hour from an instance whose clock runs ahead', async () => {
      await service.record(
        TENANT,
        [
          {
            hour: '2026-10-22T15:00:00.000Z',
            classification: 'unknown',
            enforced: true,
            count: 1,
          },
        ],
        Date.parse('2026-10-22T14:58:00.000Z'),
      );
      expect(mockBulkWrite).toHaveBeenCalledTimes(1);
    });
  });

  describe('getStats', () => {
    const RANGE_MATCH = {
      tenantId: TENANT,
      hour: {
        $gte: new Date('2026-10-21T10:00:00.000Z'),
        $lte: new Date('2026-10-21T23:59:59.000Z'),
      },
    };

    it('groups totals in MongoDB from the start hour, without reading hourly rows', async () => {
      mockAggregateExec.mockResolvedValue([
        { _id: { classification: 'nefarious', enforced: true }, count: 10 },
        { _id: { classification: 'seo', enforced: true }, count: 4 },
        { _id: { classification: 'nefarious', enforced: false }, count: 2 },
      ]);

      const result = await service.getStats(
        TENANT,
        '2026-10-21T10:30:00Z',
        '2026-10-21T23:59:59Z',
      );

      expect(mockAggregate).toHaveBeenCalledWith([
        { $match: RANGE_MATCH },
        {
          $group: {
            _id: { classification: '$classification', enforced: '$enforced' },
            count: { $sum: '$count' },
          },
        },
      ]);
      expect(mockFind).not.toHaveBeenCalled();
      expect(result).toEqual({
        blocked: 14,
        notEnforced: 2,
        byClassification: [
          { classification: 'seo', blocked: 4, notEnforced: 0 },
          { classification: 'nefarious', blocked: 10, notEnforced: 2 },
          { classification: 'unknown', blocked: 0, notEnforced: 0 },
        ],
      });
    });

    it('returns the hourly buckets, oldest first, when asked for', async () => {
      mockAggregateExec.mockResolvedValue([
        { _id: { classification: 'seo', enforced: true }, count: 4 },
      ]);
      mockExec.mockResolvedValue([
        {
          hour: new Date('2026-10-21T10:00:00.000Z'),
          classification: 'seo',
          enforced: true,
          count: 4,
        },
      ]);

      const result = await service.getStats(
        TENANT,
        '2026-10-21T10:30:00Z',
        '2026-10-21T23:59:59Z',
        { hourly: true },
      );

      expect(mockFind).toHaveBeenCalledWith(RANGE_MATCH);
      expect(mockQuery.sort).toHaveBeenCalledWith({ hour: 1 });
      expect(result.hourly).toEqual([
        {
          hour: '2026-10-21T10:00:00.000Z',
          classification: 'seo',
          enforced: true,
          count: 4,
        },
      ]);
    });

    it('returns zero totals for every classification when nothing was blocked', async () => {
      mockAggregateExec.mockResolvedValue([]);
      const result = await service.getStats(
        TENANT,
        '2026-10-21T00:00:00Z',
        '2026-10-21T23:59:59Z',
      );
      expect(result).toEqual({
        blocked: 0,
        notEnforced: 0,
        byClassification: [
          { classification: 'seo', blocked: 0, notEnforced: 0 },
          { classification: 'nefarious', blocked: 0, notEnforced: 0 },
          { classification: 'unknown', blocked: 0, notEnforced: 0 },
        ],
      });
    });
  });
});
