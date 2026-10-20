import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrintableDirectoryDelivery } from 'src/common/schemas/printable-directory-delivery.schema';
import { PrintableDirectoryDeliveryService } from './printable-directory-delivery.service';
import { PrintableDirectoryService } from './printable-directory.service';
import { CreatePrintableDirectoryDeliveryDto } from './dto';

const exec = <T>(value: T) => ({ exec: jest.fn().mockResolvedValue(value) });

const createDeliveryDoc = (overrides: Record<string, unknown> = {}) => {
  const data = {
    _id: '6ad0dcb938dccb2e7af9f9e1',
    tenantId: 'tenant-1',
    directoryId: '6ad0dcb938dccb2e7af9f9d1',
    createdByUserId: 'user-1',
    createdByEmail: 'owner@example.org',
    enabled: true,
    frequency: 'weekly',
    weekdays: [1],
    monthDays: [],
    print: {
      locale: 'en',
      variant: 'line-listing',
      fontSize: 'default',
      booklet: false,
    },
    recipients: ['a@example.org'],
    claimedForDate: null,
    lastRun: null,
    ...overrides,
  };
  return {
    ...data,
    toObject: () => data,
    save: jest.fn(),
  };
};

describe('PrintableDirectoryDeliveryService', () => {
  let service: PrintableDirectoryDeliveryService;

  const mockDeliveryModel = {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    countDocuments: jest.fn(),
    create: jest.fn(),
    deleteOne: jest.fn(),
  };

  const mockPrintableDirectoryService = {
    getEditableDirectorySummary: jest.fn(),
    getDirectorySummaries: jest.fn(),
    previewForDelivery: jest.fn(),
  };

  const directory = {
    id: '6ad0dcb938dccb2e7af9f9d1',
    name: 'Food',
    slug: 'food',
    primaryLanguage: 'en',
    locales: ['en', 'es'],
  };

  const scope = {
    tenantId: 'tenant-1',
    userId: 'user-1',
    email: 'Owner@Example.org',
  };

  const payload: CreatePrintableDirectoryDeliveryDto = {
    frequency: 'weekly',
    weekdays: [5, 1, 3, 1],
    print: {
      locale: 'es',
      variant: 'summary-listing',
      fontSize: 'large',
      booklet: true,
    },
    recipients: [' A@example.org', 'a@example.org', 'b@example.org'],
  };

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrintableDirectoryDeliveryService,
        {
          provide: getModelToken(PrintableDirectoryDelivery.name),
          useValue: mockDeliveryModel,
        },
        {
          provide: PrintableDirectoryService,
          useValue: mockPrintableDirectoryService,
        },
      ],
    }).compile();

    service = module.get(PrintableDirectoryDeliveryService);
    mockPrintableDirectoryService.getEditableDirectorySummary.mockResolvedValue(
      directory,
    );
  });

  describe('create', () => {
    it('normalizes the schedule and recipients and records the creator', async () => {
      mockDeliveryModel.countDocuments.mockReturnValue(exec(0));
      mockDeliveryModel.create.mockImplementation((data) =>
        Promise.resolve(createDeliveryDoc(data)),
      );

      const result = await service.create(
        '6ad0dcb938dccb2e7af9f9d1',
        payload,
        scope,
      );

      expect(mockDeliveryModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          directoryId: '6ad0dcb938dccb2e7af9f9d1',
          createdByUserId: 'user-1',
          createdByEmail: 'owner@example.org',
          enabled: true,
          frequency: 'weekly',
          weekdays: [1, 3, 5],
          monthDays: [],
          recipients: ['a@example.org', 'b@example.org'],
        }),
      );
      expect(result.weekdays).toEqual([1, 3, 5]);
    });

    it('rejects a weekly delivery without weekdays', async () => {
      mockDeliveryModel.countDocuments.mockReturnValue(exec(0));

      await expect(
        service.create(
          '6ad0dcb938dccb2e7af9f9d1',
          { ...payload, weekdays: [] },
          scope,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects a locale that isn't one of the directory's languages", async () => {
      mockDeliveryModel.countDocuments.mockReturnValue(exec(0));

      await expect(
        service.create(
          '6ad0dcb938dccb2e7af9f9d1',
          { ...payload, print: { ...payload.print, locale: 'fr' } },
          scope,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects the 101st delivery of a directory', async () => {
      mockDeliveryModel.countDocuments.mockReturnValue(exec(100));

      await expect(
        service.create('6ad0dcb938dccb2e7af9f9d1', payload, scope),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockDeliveryModel.create).not.toHaveBeenCalled();
    });

    it('requires an email on the token', async () => {
      await expect(
        service.create('6ad0dcb938dccb2e7af9f9d1', payload, {
          ...scope,
          email: undefined,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update', () => {
    it('clears weekdays when switching to monthly', async () => {
      const delivery = createDeliveryDoc();
      mockDeliveryModel.findOne.mockReturnValue(exec(delivery));

      await service.update(
        '6ad0dcb938dccb2e7af9f9d1',
        '6ad0dcb938dccb2e7af9f9e1',
        { frequency: 'monthly', monthDays: [16, 1] },
        scope,
      );

      expect(delivery).toMatchObject({
        frequency: 'monthly',
        weekdays: [],
        monthDays: [1, 16],
      });
      expect(delivery.save).toHaveBeenCalled();
    });
  });

  describe('listDue', () => {
    it("matches the date's weekday and month day and skips claimed deliveries", async () => {
      mockDeliveryModel.find.mockReturnValue({
        sort: () => exec([createDeliveryDoc()]),
      });
      mockPrintableDirectoryService.getDirectorySummaries.mockResolvedValue(
        new Map([['6ad0dcb938dccb2e7af9f9d1', directory]]),
      );

      // 2026-10-12 is a Monday.
      const result = await service.listDue('tenant-1', '2026-10-12');

      expect(mockDeliveryModel.find).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        enabled: true,
        claimedForDate: { $ne: '2026-10-12' },
        $or: [
          { frequency: 'weekly', weekdays: 1 },
          { frequency: 'monthly', monthDays: 12 },
        ],
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].directory).toEqual(directory);
    });

    it('leaves out deliveries whose directory is gone', async () => {
      mockDeliveryModel.find.mockReturnValue({
        sort: () => exec([createDeliveryDoc()]),
      });
      mockPrintableDirectoryService.getDirectorySummaries.mockResolvedValue(
        new Map(),
      );

      const result = await service.listDue('tenant-1', '2026-10-12');

      expect(result.items).toEqual([]);
    });

    it('rejects an invalid date', async () => {
      await expect(
        service.listDue('tenant-1', '2026-02-30'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('malformed ids', () => {
    it('answers 404 instead of a Mongoose cast error', async () => {
      await expect(
        service.claim('tenant-1', 'not-an-id', '2026-10-12'),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.previewForDelivery('tenant-1', 'zzz', 'en', {} as never),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockDeliveryModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(mockDeliveryModel.findOne).not.toHaveBeenCalled();
    });
  });

  describe('claim', () => {
    it('claims once per date', async () => {
      mockDeliveryModel.findOneAndUpdate
        .mockReturnValueOnce(exec(createDeliveryDoc()))
        .mockReturnValueOnce(exec(null));

      await expect(
        service.claim('tenant-1', '6ad0dcb938dccb2e7af9f9e1', '2026-10-12'),
      ).resolves.toEqual({ claimed: true });
      await expect(
        service.claim('tenant-1', '6ad0dcb938dccb2e7af9f9e1', '2026-10-12'),
      ).resolves.toEqual({ claimed: false });

      expect(mockDeliveryModel.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: '6ad0dcb938dccb2e7af9f9e1',
          tenantId: 'tenant-1',
          claimedForDate: { $ne: '2026-10-12' },
        },
        { $set: { claimedForDate: '2026-10-12' } },
      );
    });
  });
});
