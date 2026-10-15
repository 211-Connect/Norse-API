import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PrintableDirectoryDeliveryDocument =
  HydratedDocument<PrintableDirectoryDelivery>;

/** Per-directory cap on scheduled deliveries. */
export const PRINTABLE_DIRECTORY_MAX_DELIVERIES = 100;
/** Per-delivery cap on recipient emails. */
export const PRINTABLE_DIRECTORY_DELIVERY_MAX_RECIPIENTS = 100;
/** Month days stop at 28 so every month gets every selected day. */
export const PRINTABLE_DIRECTORY_DELIVERY_MAX_MONTH_DAY = 28;

export const PRINTABLE_DIRECTORY_DELIVERY_FREQUENCIES = [
  'weekly',
  'monthly',
] as const;
export type PrintableDirectoryDeliveryFrequency =
  (typeof PRINTABLE_DIRECTORY_DELIVERY_FREQUENCIES)[number];

/** Mirrors the Norse print dialog's templates (`PRINT_VARIANTS`). */
export const PRINTABLE_DIRECTORY_PRINT_VARIANTS = [
  'line-listing',
  'summary-listing',
  'full-listing',
] as const;
export type PrintableDirectoryPrintVariant =
  (typeof PRINTABLE_DIRECTORY_PRINT_VARIANTS)[number];

/** Mirrors the Norse print dialog's font sizes (`FONT_SIZE_MODES`). */
export const PRINTABLE_DIRECTORY_PRINT_FONT_SIZES = [
  'default',
  'large',
] as const;
export type PrintableDirectoryPrintFontSize =
  (typeof PRINTABLE_DIRECTORY_PRINT_FONT_SIZES)[number];

export const PRINTABLE_DIRECTORY_DELIVERY_RUN_STATUSES = [
  'sent',
  'sent_as_link',
  'failed',
  'skipped',
] as const;
export type PrintableDirectoryDeliveryRunStatus =
  (typeof PRINTABLE_DIRECTORY_DELIVERY_RUN_STATUSES)[number];

@Schema({ _id: false })
export class PrintableDirectoryDeliveryPrintOptions {
  @Prop({ required: true, type: String })
  locale: string;

  @Prop({
    required: true,
    type: String,
    enum: PRINTABLE_DIRECTORY_PRINT_VARIANTS,
  })
  variant: PrintableDirectoryPrintVariant;

  @Prop({
    required: true,
    type: String,
    enum: PRINTABLE_DIRECTORY_PRINT_FONT_SIZES,
    default: 'default',
  })
  fontSize: PrintableDirectoryPrintFontSize;

  @Prop({ required: true, type: Boolean, default: false })
  booklet: boolean;
}

@Schema({ _id: false })
export class PrintableDirectoryDeliveryLastRun {
  /** Calendar date (America/New_York) of the run, `YYYY-MM-DD`. */
  @Prop({ required: true, type: String })
  date: string;

  @Prop({
    required: true,
    type: String,
    enum: PRINTABLE_DIRECTORY_DELIVERY_RUN_STATUSES,
  })
  status: PrintableDirectoryDeliveryRunStatus;

  @Prop({ type: String, default: null })
  reason?: string | null;

  @Prop({ required: true, type: Date })
  at: Date;
}

/**
 * A recurring email delivery of a printable directory's PDF. See Norse's
 * docs/scheduled-pdf-delivery.md. Kept out of the directory document so
 * recipient lists don't bloat directory reads and each delivery can be
 * claimed atomically by the daily job.
 */
@Schema({ timestamps: true, collection: 'printableDirectoryDeliveries' })
export class PrintableDirectoryDelivery {
  @Prop({ required: true, index: true })
  tenantId: string;

  @Prop({ required: true, index: true, type: String })
  directoryId: string;

  @Prop({ required: true, type: String })
  createdByUserId: string;

  /** From the creator's verified token; the job re-checks its capability. */
  @Prop({ required: true, type: String })
  createdByEmail: string;

  @Prop({ required: true, type: Boolean, default: true })
  enabled: boolean;

  @Prop({
    required: true,
    type: String,
    enum: PRINTABLE_DIRECTORY_DELIVERY_FREQUENCIES,
  })
  frequency: PrintableDirectoryDeliveryFrequency;

  /** 0–6 (Sunday–Saturday); empty unless `frequency` is `weekly`. */
  @Prop({ type: [Number], default: [] })
  weekdays: number[];

  /** 1–28; empty unless `frequency` is `monthly`. */
  @Prop({ type: [Number], default: [] })
  monthDays: number[];

  @Prop({ required: true, type: PrintableDirectoryDeliveryPrintOptions })
  print: PrintableDirectoryDeliveryPrintOptions;

  @Prop({ type: [String], default: [] })
  recipients: string[];

  /** The date this delivery was last claimed by the job (idempotency lock). */
  @Prop({ type: String, default: null })
  claimedForDate?: string | null;

  @Prop({ type: PrintableDirectoryDeliveryLastRun, default: null })
  lastRun?: PrintableDirectoryDeliveryLastRun | null;

  @Prop({ type: Date, default: null })
  createdAt?: Date;

  @Prop({ type: Date, default: null })
  updatedAt?: Date;
}

export const PrintableDirectoryDeliverySchema = SchemaFactory.createForClass(
  PrintableDirectoryDelivery,
);

PrintableDirectoryDeliverySchema.index({
  tenantId: 1,
  enabled: 1,
  frequency: 1,
  weekdays: 1,
});
PrintableDirectoryDeliverySchema.index({
  tenantId: 1,
  enabled: 1,
  frequency: 1,
  monthDays: 1,
});
PrintableDirectoryDeliverySchema.index({ tenantId: 1, directoryId: 1 });
