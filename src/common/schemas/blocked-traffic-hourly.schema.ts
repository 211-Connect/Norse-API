import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type BlockedTrafficHourlyDocument =
  HydratedDocument<BlockedTrafficHourly>;

/** Mirrors Norse's `classifyBlockedTraffic` (src/lib/arcjet-classification.ts). */
export const BLOCKED_TRAFFIC_CLASSIFICATIONS = [
  'seo',
  'nefarious',
  'unknown',
] as const;
export type BlockedTrafficClassification =
  (typeof BLOCKED_TRAFFIC_CLASSIFICATIONS)[number];

/**
 * Requests Norse's Arcjet protection denied, counted per tenant, UTC hour,
 * classification and enforcement. One document per bucket; Norse instances
 * push per-minute deltas that are `$inc`-upserted into it, so concurrent
 * pushes from several instances add up without a read-modify-write.
 */
@Schema({ collection: 'blocked_traffic_hourly', versionKey: false })
export class BlockedTrafficHourly {
  @Prop({ required: true, type: String })
  tenantId: string;

  /** Start of the UTC hour the denials fall in. */
  @Prop({ required: true, type: Date })
  hour: Date;

  @Prop({ required: true, type: String, enum: BLOCKED_TRAFFIC_CLASSIFICATIONS })
  classification: BlockedTrafficClassification;

  /** false: the host was observe-only, so the request was detected but served. */
  @Prop({ required: true, type: Boolean })
  enforced: boolean;

  @Prop({ required: true, type: Number, default: 0 })
  count: number;
}

export const BlockedTrafficHourlySchema =
  SchemaFactory.createForClass(BlockedTrafficHourly);

// The upsert key; its tenantId + hour prefix also serves the range read.
BlockedTrafficHourlySchema.index(
  { tenantId: 1, hour: 1, classification: 1, enforced: 1 },
  { unique: true },
);
