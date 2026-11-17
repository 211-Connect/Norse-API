import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

import {
  BLOCKED_TRAFFIC_CLASSIFICATIONS,
  type BlockedTrafficClassification,
} from './blocked-traffic-hourly.schema';

export type CrawlerTrafficHourlyDocument =
  HydratedDocument<CrawlerTrafficHourly>;

/**
 * What happened to a request Norse counted (see docs/crawler-traffic.md):
 * - `blocked`: Arcjet denied it on an enforced host; the client got a 403.
 * - `logged`: Arcjet denied it on an observe-only host; the page was served.
 * - `rate_limited`: Arcjet's per-IP rate limit denied it on an enforced host (403).
 * - `allowed`: an allowed crawler (e.g. Googlebot), served.
 * - `shed`: Norse's per-tenant load limit answered 429 before Arcjet ran.
 */
export const CRAWLER_TRAFFIC_OUTCOMES = [
  'blocked',
  'logged',
  'rate_limited',
  'allowed',
  'shed',
] as const;
export type CrawlerTrafficOutcome = (typeof CRAWLER_TRAFFIC_OUTCOMES)[number];

/** Outcomes that ended in a 403, as the Blocked Bots totals count them. */
export const CRAWLER_TRAFFIC_ENFORCED_OUTCOMES: readonly CrawlerTrafficOutcome[] =
  ['blocked', 'rate_limited'];
/** Outcomes detected but served (observe-only host). */
export const CRAWLER_TRAFFIC_NOT_ENFORCED_OUTCOMES: readonly CrawlerTrafficOutcome[] =
  ['logged'];

/**
 * Requests Norse counted, per tenant, UTC hour, crawler and outcome. One
 * document per bucket; Norse instances push per-minute deltas that are
 * `$inc`-upserted, so pushes from several instances add up without a
 * read-modify-write. Kept forever (no TTL): at most a few thousand small
 * documents per tenant per month.
 */
@Schema({ collection: 'crawler_traffic_hourly', versionKey: false })
export class CrawlerTrafficHourly {
  @Prop({ required: true, type: String })
  tenantId: string;

  /** Start of the UTC hour the requests fall in. */
  @Prop({ required: true, type: Date })
  hour: Date;

  /**
   * Arcjet bot name (e.g. `AHREFS_CRAWLER`); empty when the request carried
   * no identified crawler (an unidentified client, or a load-limit 429).
   */
  @Prop({ type: String, default: '' })
  crawler: string;

  @Prop({ required: true, type: String, enum: CRAWLER_TRAFFIC_OUTCOMES })
  outcome: CrawlerTrafficOutcome;

  @Prop({ required: true, type: String, enum: BLOCKED_TRAFFIC_CLASSIFICATIONS })
  classification: BlockedTrafficClassification;

  @Prop({ required: true, type: Number, default: 0 })
  count: number;
}

export const CrawlerTrafficHourlySchema =
  SchemaFactory.createForClass(CrawlerTrafficHourly);

// The upsert key; its tenantId + hour prefix also serves per-tenant range reads.
CrawlerTrafficHourlySchema.index(
  { tenantId: 1, hour: 1, crawler: 1, outcome: 1, classification: 1 },
  { unique: true },
);

// All-tenants range reads (super admin view).
CrawlerTrafficHourlySchema.index({ hour: 1 });
