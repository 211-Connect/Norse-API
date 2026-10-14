import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PRINTABLE_DIRECTORY_MAX_DELIVERIES,
  PrintableDirectoryDelivery,
  PrintableDirectoryDeliveryDocument,
  PrintableDirectoryDeliveryFrequency,
} from 'src/common/schemas/printable-directory-delivery.schema';
import { HeadersDto } from 'src/common/dto/headers.dto';
import {
  ClaimPrintableDirectoryDeliveryResponseDto,
  CreatePrintableDirectoryDeliveryDto,
  DuePrintableDirectoryDeliveryListResponseDto,
  PrintableDirectoryDeliveryListResponseDto,
  PrintableDirectoryDeliveryResponseDto,
  PrintableDirectoryPreviewResponseDto,
  ReportPrintableDirectoryDeliveryResultDto,
  UpdatePrintableDirectoryDeliveryDto,
} from './dto';
import {
  PrintableDirectoryService,
  PrintableDirectorySummary,
} from './printable-directory.service';

interface UserScope {
  tenantId: string;
  userId: string;
  email?: string;
}

const sortedUnique = (values: number[]) =>
  Array.from(new Set(values)).sort((a, b) => a - b);

/**
 * Scheduled PDF deliveries of printable directories. User-facing methods
 * require edit access to the directory; tenant-level capability checks live
 * in Norse (ADR 0001). Internal methods serve Norse's daily delivery job.
 */
@Injectable()
export class PrintableDirectoryDeliveryService {
  constructor(
    @InjectModel(PrintableDirectoryDelivery.name)
    private readonly deliveryModel: Model<PrintableDirectoryDeliveryDocument>,
    private readonly printableDirectoryService: PrintableDirectoryService,
  ) {}

  async list(
    directoryId: string,
    scope: UserScope,
  ): Promise<PrintableDirectoryDeliveryListResponseDto> {
    await this.printableDirectoryService.getEditableDirectorySummary(
      directoryId,
      scope,
    );

    const deliveries = await this.deliveryModel
      .find({ tenantId: scope.tenantId, directoryId })
      .sort({ createdAt: 1 })
      .exec();

    return {
      items: deliveries.map((delivery) => this.toResponseDto(delivery)),
    };
  }

  async create(
    directoryId: string,
    payload: CreatePrintableDirectoryDeliveryDto,
    scope: UserScope,
  ): Promise<PrintableDirectoryDeliveryResponseDto> {
    if (!scope.email) {
      throw new BadRequestException(
        'The authenticated user has no email address.',
      );
    }

    const directory =
      await this.printableDirectoryService.getEditableDirectorySummary(
        directoryId,
        scope,
      );

    const count = await this.deliveryModel
      .countDocuments({ tenantId: scope.tenantId, directoryId })
      .exec();
    if (count >= PRINTABLE_DIRECTORY_MAX_DELIVERIES) {
      throw new ConflictException(
        `A directory can have at most ${PRINTABLE_DIRECTORY_MAX_DELIVERIES} scheduled deliveries.`,
      );
    }

    const delivery = await this.deliveryModel.create({
      tenantId: scope.tenantId,
      directoryId,
      createdByUserId: scope.userId,
      createdByEmail: scope.email.trim().toLowerCase(),
      enabled: payload.enabled ?? true,
      ...this.normalizeSchedule(
        payload.frequency,
        payload.weekdays,
        payload.monthDays,
      ),
      print: this.validatePrintOptions(payload.print, directory),
      recipients: this.normalizeRecipients(payload.recipients),
    });

    return this.toResponseDto(delivery);
  }

  async update(
    directoryId: string,
    deliveryId: string,
    payload: UpdatePrintableDirectoryDeliveryDto,
    scope: UserScope,
  ): Promise<PrintableDirectoryDeliveryResponseDto> {
    const directory =
      await this.printableDirectoryService.getEditableDirectorySummary(
        directoryId,
        scope,
      );
    const delivery = await this.getDeliveryOrThrow(
      directoryId,
      deliveryId,
      scope.tenantId,
    );

    if (payload.enabled !== undefined) {
      delivery.enabled = payload.enabled;
    }

    if (
      payload.frequency !== undefined ||
      payload.weekdays !== undefined ||
      payload.monthDays !== undefined
    ) {
      const frequency = payload.frequency ?? delivery.frequency;
      Object.assign(
        delivery,
        this.normalizeSchedule(
          frequency,
          payload.weekdays ??
            (frequency === delivery.frequency ? delivery.weekdays : []),
          payload.monthDays ??
            (frequency === delivery.frequency ? delivery.monthDays : []),
        ),
      );
    }

    if (payload.print !== undefined) {
      delivery.print = this.validatePrintOptions(payload.print, directory);
    }

    if (payload.recipients !== undefined) {
      delivery.recipients = this.normalizeRecipients(payload.recipients);
    }

    await delivery.save();
    return this.toResponseDto(delivery);
  }

  async remove(
    directoryId: string,
    deliveryId: string,
    scope: UserScope,
  ): Promise<void> {
    await this.printableDirectoryService.getEditableDirectorySummary(
      directoryId,
      scope,
    );
    const delivery = await this.getDeliveryOrThrow(
      directoryId,
      deliveryId,
      scope.tenantId,
    );
    await this.deliveryModel.deleteOne({ _id: delivery._id }).exec();
  }

  /**
   * Enabled deliveries of the tenant scheduled for this calendar date and not
   * yet claimed for it. Deliveries whose directory no longer exists are left
   * out.
   */
  async listDue(
    tenantId: string,
    date: string,
  ): Promise<DuePrintableDirectoryDeliveryListResponseDto> {
    const { weekday, monthDay } = this.parseCalendarDate(date);

    const deliveries = await this.deliveryModel
      .find({
        tenantId,
        enabled: true,
        claimedForDate: { $ne: date },
        $or: [
          { frequency: 'weekly', weekdays: weekday },
          { frequency: 'monthly', monthDays: monthDay },
        ],
      })
      .sort({ createdAt: 1 })
      .exec();

    if (deliveries.length === 0) {
      return { items: [] };
    }

    const directories =
      await this.printableDirectoryService.getDirectorySummaries(tenantId, [
        ...new Set(deliveries.map((delivery) => delivery.directoryId)),
      ]);

    return {
      items: deliveries.flatMap((delivery) => {
        const directory = directories.get(delivery.directoryId);
        return directory
          ? [{ ...this.toResponseDto(delivery), directory }]
          : [];
      }),
    };
  }

  /** Atomically marks the delivery as handled for `date`. */
  async claim(
    tenantId: string,
    deliveryId: string,
    date: string,
  ): Promise<ClaimPrintableDirectoryDeliveryResponseDto> {
    this.parseCalendarDate(date);

    const claimed = await this.deliveryModel
      .findOneAndUpdate(
        { _id: deliveryId, tenantId, claimedForDate: { $ne: date } },
        { $set: { claimedForDate: date } },
      )
      .exec();

    return { claimed: Boolean(claimed) };
  }

  async reportResult(
    tenantId: string,
    deliveryId: string,
    payload: ReportPrintableDirectoryDeliveryResultDto,
  ): Promise<PrintableDirectoryDeliveryResponseDto> {
    const delivery = await this.deliveryModel
      .findOneAndUpdate(
        { _id: deliveryId, tenantId },
        {
          $set: {
            lastRun: {
              date: payload.date,
              status: payload.status,
              reason: payload.reason ?? null,
              at: new Date(),
            },
          },
        },
        { new: true },
      )
      .exec();

    if (!delivery) {
      throw new NotFoundException('Scheduled delivery not found');
    }

    return this.toResponseDto(delivery);
  }

  async previewForDelivery(
    tenantId: string,
    deliveryId: string,
    locale: string | undefined,
    headers: HeadersDto,
  ): Promise<PrintableDirectoryPreviewResponseDto> {
    const delivery = await this.deliveryModel
      .findOne({ _id: deliveryId, tenantId })
      .exec();

    if (!delivery) {
      throw new NotFoundException('Scheduled delivery not found');
    }

    return this.printableDirectoryService.previewForDelivery(
      delivery.directoryId,
      tenantId,
      locale ?? delivery.print.locale,
      headers,
    );
  }

  private async getDeliveryOrThrow(
    directoryId: string,
    deliveryId: string,
    tenantId: string,
  ): Promise<PrintableDirectoryDeliveryDocument> {
    const delivery = await this.deliveryModel
      .findOne({ _id: deliveryId, tenantId, directoryId })
      .exec();

    if (!delivery) {
      throw new NotFoundException('Scheduled delivery not found');
    }

    return delivery;
  }

  private normalizeSchedule(
    frequency: PrintableDirectoryDeliveryFrequency,
    weekdays: number[] | undefined,
    monthDays: number[] | undefined,
  ): Pick<PrintableDirectoryDelivery, 'frequency' | 'weekdays' | 'monthDays'> {
    if (frequency === 'weekly') {
      const days = sortedUnique(weekdays ?? []);
      if (days.length === 0) {
        throw new BadRequestException(
          'A weekly delivery needs at least one weekday.',
        );
      }
      return { frequency, weekdays: days, monthDays: [] };
    }

    const days = sortedUnique(monthDays ?? []);
    if (days.length === 0) {
      throw new BadRequestException(
        'A monthly delivery needs at least one day of the month.',
      );
    }
    return { frequency, weekdays: [], monthDays: days };
  }

  private validatePrintOptions<T extends { locale: string }>(
    print: T,
    directory: PrintableDirectorySummary,
  ): T {
    if (!directory.locales.includes(print.locale)) {
      throw new BadRequestException(
        `Locale "${print.locale}" is not one of the directory's languages.`,
      );
    }
    return print;
  }

  private normalizeRecipients(recipients: string[]): string[] {
    return Array.from(
      new Set(
        recipients.map((email) => email.trim().toLowerCase()).filter(Boolean),
      ),
    );
  }

  /** Weekday (0 = Sunday) and day of month of a `YYYY-MM-DD` calendar date. */
  private parseCalendarDate(date: string): {
    weekday: number;
    monthDay: number;
  } {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date
    ) {
      throw new BadRequestException(`Invalid date "${date}".`);
    }
    return { weekday: parsed.getUTCDay(), monthDay: parsed.getUTCDate() };
  }

  private toResponseDto(
    deliveryDocument: PrintableDirectoryDeliveryDocument,
  ): PrintableDirectoryDeliveryResponseDto {
    const delivery = deliveryDocument.toObject();

    return {
      id: String(delivery._id),
      directoryId: delivery.directoryId,
      createdByEmail: delivery.createdByEmail,
      enabled: delivery.enabled,
      frequency: delivery.frequency,
      weekdays: delivery.weekdays ?? [],
      monthDays: delivery.monthDays ?? [],
      print: {
        locale: delivery.print.locale,
        variant: delivery.print.variant,
        fontSize: delivery.print.fontSize,
        booklet: delivery.print.booklet,
      },
      recipients: delivery.recipients ?? [],
      lastRun: delivery.lastRun
        ? {
            date: delivery.lastRun.date,
            status: delivery.lastRun.status,
            reason: delivery.lastRun.reason ?? null,
            at: delivery.lastRun.at.toISOString(),
          }
        : null,
      createdAt: delivery.createdAt?.toISOString(),
      updatedAt: delivery.updatedAt?.toISOString(),
    };
  }
}
