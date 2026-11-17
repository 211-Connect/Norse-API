import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';

import { BlockedTrafficClassification } from '../../common/schemas/blocked-traffic-hourly.schema';
import {
  CRAWLER_TRAFFIC_OUTCOMES,
  CrawlerTrafficHourly,
  CrawlerTrafficOutcome,
} from '../../common/schemas/crawler-traffic-hourly.schema';
import {
  CRAWLER_TRAFFIC_MAX_HOURLY_RANGE_DAYS,
  CrawlerTrafficAllTenantsResponse,
  CrawlerTrafficBucketDto,
  CrawlerTrafficCountsDto,
  CrawlerTrafficGranularity,
  CrawlerTrafficResponse,
} from '../dto';

const ONE_HOUR_MS = 3_600_000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
/** A push may not land in an hour older than this (Norse retains ≤ 24 h). */
export const CRAWLER_TRAFFIC_MAX_BUCKET_AGE_MS = 7 * ONE_DAY_MS;
/** Clock skew allowed between a Norse instance and this service. */
const CLOCK_SKEW_MS = 5 * 60_000;
/** Rows returned in `byCrawler`. */
export const CRAWLER_TRAFFIC_TOP_CRAWLERS = 100;

function floorToHour(ms: number): number {
  return Math.floor(ms / ONE_HOUR_MS) * ONE_HOUR_MS;
}

/** `outcome` → response field. */
const OUTCOME_FIELDS: Record<
  CrawlerTrafficOutcome,
  keyof Omit<CrawlerTrafficCountsDto, 'total'>
> = {
  blocked: 'blocked',
  logged: 'logged',
  rate_limited: 'rateLimited',
  allowed: 'allowed',
  shed: 'shed',
};

/** `$group` accumulators: one sum per outcome, plus the total. */
const OUTCOME_SUMS = Object.fromEntries([
  ...CRAWLER_TRAFFIC_OUTCOMES.map((outcome) => [
    OUTCOME_FIELDS[outcome],
    { $sum: { $cond: [{ $eq: ['$outcome', outcome] }, '$count', 0] } },
  ]),
  ['total', { $sum: '$count' }],
]);

type CountsRow = CrawlerTrafficCountsDto & { _id: unknown };

function toCounts(
  row: Partial<CountsRow> | undefined,
): CrawlerTrafficCountsDto {
  return {
    blocked: row?.blocked ?? 0,
    logged: row?.logged ?? 0,
    rateLimited: row?.rateLimited ?? 0,
    allowed: row?.allowed ?? 0,
    shed: row?.shed ?? 0,
    total: row?.total ?? 0,
  };
}

/**
 * Per-crawler request counts from Norse (blocked, logged, rate-limited,
 * allowed and load-limited requests), kept per tenant and UTC hour forever.
 * Norse aggregates in memory and pushes per-minute deltas; this service
 * `$inc`-upserts them, so the write rate is per tenant per instance per
 * minute, not per request. See docs/crawler-traffic.md.
 */
@Injectable()
export class CrawlerTrafficService {
  constructor(
    @InjectModel(CrawlerTrafficHourly.name)
    private readonly model: Model<CrawlerTrafficHourly>,
  ) {}

  async record(
    tenantId: string,
    buckets: CrawlerTrafficBucketDto[],
    now = Date.now(),
  ): Promise<number> {
    const merged = new Map<
      string,
      {
        hour: number;
        crawler: string;
        outcome: CrawlerTrafficOutcome;
        classification: BlockedTrafficClassification;
        count: number;
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
      if (hour < floorToHour(now - CRAWLER_TRAFFIC_MAX_BUCKET_AGE_MS)) {
        throw new BadRequestException(`hour is too old: ${bucket.hour}`);
      }

      const key = `${hour}|${bucket.crawler}|${bucket.outcome}|${bucket.classification}`;
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
            crawler: bucket.crawler,
            outcome: bucket.outcome,
            classification: bucket.classification,
          },
          update: { $inc: { count: bucket.count } },
          upsert: true,
        },
      };
    });

    await this.model.bulkWrite(operations, { ordered: false });
    return recorded;
  }

  /** One tenant's counts: totals, top crawlers and an hour/day series. */
  getStats(
    tenantId: string,
    start: string,
    end: string,
    granularity: CrawlerTrafficGranularity = 'day',
  ): Promise<CrawlerTrafficResponse> {
    return this.aggregate({
      tenantId,
      start,
      end,
      granularity,
      byTenant: false,
    });
  }

  /** Every tenant's counts together, plus a per-tenant breakdown. */
  getAllTenantsStats(
    start: string,
    end: string,
    granularity: CrawlerTrafficGranularity = 'day',
  ): Promise<CrawlerTrafficAllTenantsResponse> {
    return this.aggregate({ start, end, granularity, byTenant: true });
  }

  private async aggregate(options: {
    tenantId?: string;
    start: string;
    end: string;
    granularity: CrawlerTrafficGranularity;
    byTenant: true;
  }): Promise<CrawlerTrafficAllTenantsResponse>;
  private async aggregate(options: {
    tenantId: string;
    start: string;
    end: string;
    granularity: CrawlerTrafficGranularity;
    byTenant: false;
  }): Promise<CrawlerTrafficResponse>;
  private async aggregate({
    tenantId,
    start,
    end,
    granularity,
    byTenant,
  }: {
    tenantId?: string;
    start: string;
    end: string;
    granularity: CrawlerTrafficGranularity;
    byTenant: boolean;
  }): Promise<CrawlerTrafficResponse | CrawlerTrafficAllTenantsResponse> {
    const startMs = floorToHour(Date.parse(start));
    const endMs = Date.parse(end);
    if (
      granularity === 'hour' &&
      endMs - startMs > CRAWLER_TRAFFIC_MAX_HOURLY_RANGE_DAYS * ONE_DAY_MS
    ) {
      throw new BadRequestException(
        `granularity=hour is limited to ${CRAWLER_TRAFFIC_MAX_HOURLY_RANGE_DAYS} days; use granularity=day`,
      );
    }

    const match = {
      ...(tenantId !== undefined && { tenantId }),
      hour: { $gte: new Date(startMs), $lte: new Date(endMs) },
    };

    // Day buckets: the hour minus its offset into the UTC day.
    const bucketExpression =
      granularity === 'hour'
        ? '$hour'
        : {
            $subtract: ['$hour', { $mod: [{ $toLong: '$hour' }, ONE_DAY_MS] }],
          };

    const facets: Record<string, PipelineStage.FacetPipelineStage[]> = {
      totals: [{ $group: { _id: null, ...OUTCOME_SUMS } }],
      byCrawler: [
        {
          $group: {
            _id: { crawler: '$crawler', classification: '$classification' },
            ...OUTCOME_SUMS,
          },
        },
        { $sort: { total: -1, '_id.crawler': 1 } },
        { $limit: CRAWLER_TRAFFIC_TOP_CRAWLERS },
      ],
      series: [
        { $group: { _id: bucketExpression, ...OUTCOME_SUMS } },
        { $sort: { _id: 1 } },
      ],
    };
    if (byTenant) {
      facets.byTenant = [
        { $group: { _id: '$tenantId', ...OUTCOME_SUMS } },
        { $sort: { total: -1, _id: 1 } },
      ];
    }

    const [result] = await this.model
      .aggregate<{
        totals: CountsRow[];
        byCrawler: (CountsRow & {
          _id: {
            crawler: string;
            classification: BlockedTrafficClassification;
          };
        })[];
        series: (CountsRow & { _id: Date })[];
        byTenant?: (CountsRow & { _id: string })[];
      }>([{ $match: match }, { $facet: facets }])
      .exec();

    const response: CrawlerTrafficResponse = {
      granularity,
      totals: toCounts(result?.totals[0]),
      byCrawler: (result?.byCrawler ?? []).map((row) => ({
        crawler: row._id.crawler ?? '',
        classification: row._id.classification,
        ...toCounts(row),
      })),
      series: (result?.series ?? []).map((row) => ({
        bucket: new Date(row._id).toISOString(),
        ...toCounts(row),
      })),
    };

    if (!byTenant) return response;
    return {
      ...response,
      byTenant: (result?.byTenant ?? []).map((row) => ({
        tenantId: row._id,
        ...toCounts(row),
      })),
    };
  }
}
