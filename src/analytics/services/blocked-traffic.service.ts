import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  BLOCKED_TRAFFIC_CLASSIFICATIONS,
  BlockedTrafficHourly,
} from '../../common/schemas/blocked-traffic-hourly.schema';
import {
  CRAWLER_TRAFFIC_ENFORCED_OUTCOMES,
  CRAWLER_TRAFFIC_NOT_ENFORCED_OUTCOMES,
  CrawlerTrafficHourly,
} from '../../common/schemas/crawler-traffic-hourly.schema';
import {
  BlockedTrafficBucketDto,
  BlockedTrafficClassificationTotalDto,
  BlockedTrafficResponse,
} from '../dto';

const ONE_HOUR_MS = 3_600_000;
/** A push may not land in an hour older than this (Norse retains ≤ 24 h). */
export const BLOCKED_TRAFFIC_MAX_BUCKET_AGE_MS = 7 * 24 * ONE_HOUR_MS;
/** Clock skew allowed between a Norse instance and this service. */
const CLOCK_SKEW_MS = 5 * 60_000;

function floorToHour(ms: number): number {
  return Math.floor(ms / ONE_HOUR_MS) * ONE_HOUR_MS;
}

/**
 * Hourly per-tenant counts of requests Norse's Arcjet protection denied
 * (ISS-2366). Norse aggregates in memory and pushes per-minute deltas; this
 * service `$inc`-upserts them, so the write rate is per tenant per instance
 * per minute, not per denied request. See docs/blocked-traffic.md.
 */
@Injectable()
export class BlockedTrafficService {
  constructor(
    @InjectModel(BlockedTrafficHourly.name)
    private readonly model: Model<BlockedTrafficHourly>,
    @InjectModel(CrawlerTrafficHourly.name)
    private readonly crawlerModel: Model<CrawlerTrafficHourly>,
  ) {}

  /**
   * @deprecated Only for Norse instances still on the old counters during
   * a deploy; current Norse calls `CrawlerTrafficService.record`.
   */
  async record(
    tenantId: string,
    buckets: BlockedTrafficBucketDto[],
    now = Date.now(),
  ): Promise<number> {
    const merged = new Map<
      string,
      Pick<BlockedTrafficHourly, 'classification' | 'enforced' | 'count'> & {
        hour: number;
      }
    >();

    for (const bucket of buckets) {
      const hour = Date.parse(bucket.hour);
      if (hour !== floorToHour(hour)) {
        throw new BadRequestException(
          `hour must be the start of a UTC hour: ${bucket.hour}`,
        );
      }
      if (hour > now + CLOCK_SKEW_MS) {
        throw new BadRequestException(`hour is in the future: ${bucket.hour}`);
      }
      if (hour < floorToHour(now - BLOCKED_TRAFFIC_MAX_BUCKET_AGE_MS)) {
        throw new BadRequestException(`hour is too old: ${bucket.hour}`);
      }

      const key = `${hour}|${bucket.classification}|${bucket.enforced}`;
      const existing = merged.get(key);
      if (existing) existing.count += bucket.count;
      else merged.set(key, { ...bucket, hour });
    }

    let recorded = 0;
    const operations = [...merged.values()].map((bucket) => {
      recorded += bucket.count;
      return {
        updateOne: {
          filter: {
            tenantId,
            hour: new Date(bucket.hour),
            classification: bucket.classification,
            enforced: bucket.enforced,
          },
          update: { $inc: { count: bucket.count } },
          upsert: true,
        },
      };
    });

    await this.model.bulkWrite(operations, { ordered: false });
    return recorded;
  }

  /**
   * Totals are grouped in MongoDB (a handful of rows back, whatever the
   * range); the hourly series is read only when asked for. All reads use the
   * `{ tenantId, hour, ... }` indexes.
   *
   * Since Norse switched to per-crawler counters, new denials live in
   * `crawler_traffic_hourly` (see CrawlerTrafficService); this collection
   * holds the history from before. Both are read and summed: a bucket is
   * only ever written to one of them, so nothing is counted twice.
   */
  async getStats(
    tenantId: string,
    start: string,
    end: string,
    options: { hourly?: boolean } = {},
  ): Promise<BlockedTrafficResponse> {
    const match = {
      tenantId,
      hour: {
        $gte: new Date(floorToHour(Date.parse(start))),
        $lte: new Date(Date.parse(end)),
      },
    };
    const crawlerMatch = {
      ...match,
      outcome: {
        $in: [
          ...CRAWLER_TRAFFIC_ENFORCED_OUTCOMES,
          ...CRAWLER_TRAFFIC_NOT_ENFORCED_OUTCOMES,
        ],
      },
    };
    const crawlerEnforced = {
      $in: ['$outcome', [...CRAWLER_TRAFFIC_ENFORCED_OUTCOMES]],
    };

    type Group = {
      _id: { classification: string; enforced: boolean };
      count: number;
    };
    type HourlyGroup = {
      _id: { hour: Date; classification: string; enforced: boolean };
      count: number;
    };

    const [legacyGroups, crawlerGroups, legacyRows, crawlerRows] =
      await Promise.all([
        this.model
          .aggregate<Group>([
            { $match: match },
            {
              $group: {
                _id: {
                  classification: '$classification',
                  enforced: '$enforced',
                },
                count: { $sum: '$count' },
              },
            },
          ])
          .exec(),
        this.crawlerModel
          .aggregate<Group>([
            { $match: crawlerMatch },
            {
              $group: {
                _id: {
                  classification: '$classification',
                  enforced: crawlerEnforced,
                },
                count: { $sum: '$count' },
              },
            },
          ])
          .exec(),
        options.hourly
          ? this.model.find(match).sort({ hour: 1 }).lean().exec()
          : undefined,
        options.hourly
          ? this.crawlerModel
              .aggregate<HourlyGroup>([
                { $match: crawlerMatch },
                {
                  $group: {
                    _id: {
                      hour: '$hour',
                      classification: '$classification',
                      enforced: crawlerEnforced,
                    },
                    count: { $sum: '$count' },
                  },
                },
              ])
              .exec()
          : undefined,
      ]);

    const totals = new Map<string, BlockedTrafficClassificationTotalDto>(
      BLOCKED_TRAFFIC_CLASSIFICATIONS.map((classification) => [
        classification,
        { classification, blocked: 0, notEnforced: 0 },
      ]),
    );

    let blocked = 0;
    let notEnforced = 0;
    for (const { _id, count } of [...legacyGroups, ...crawlerGroups]) {
      const total = totals.get(_id.classification);
      if (_id.enforced) {
        blocked += count;
        if (total) total.blocked += count;
      } else {
        notEnforced += count;
        if (total) total.notEnforced += count;
      }
    }

    let hourly: BlockedTrafficResponse['hourly'];
    if (legacyRows || crawlerRows) {
      const buckets = new Map<
        string,
        NonNullable<BlockedTrafficResponse['hourly']>[number]
      >();
      const add = (
        hour: Date,
        classification: string,
        enforced: boolean,
        count: number,
      ) => {
        const iso = new Date(hour).toISOString();
        const key = `${iso}|${classification}|${enforced}`;
        const existing = buckets.get(key);
        if (existing) existing.count += count;
        else
          buckets.set(key, {
            hour: iso,
            classification:
              classification as BlockedTrafficHourly['classification'],
            enforced,
            count,
          });
      };
      for (const row of legacyRows ?? [])
        add(row.hour, row.classification, row.enforced, row.count);
      for (const { _id, count } of crawlerRows ?? [])
        add(_id.hour, _id.classification, _id.enforced, count);
      hourly = [...buckets.values()].sort((a, b) =>
        a.hour.localeCompare(b.hour),
      );
    }

    return {
      blocked,
      notEnforced,
      byClassification: [...totals.values()],
      ...(hourly && { hourly }),
    };
  }
}
