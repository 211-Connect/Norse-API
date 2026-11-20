import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Validate,
} from 'class-validator';

import { AnalyticsDateRangeConstraint } from './common-query.dto';

export const CRAWLER_TRAFFIC_GRANULARITIES = ['hour', 'day'] as const;
export type CrawlerTrafficGranularity =
  (typeof CRAWLER_TRAFFIC_GRANULARITIES)[number];

/** Longest range the hourly series may cover (31 days ≈ 744 points). */
export const CRAWLER_TRAFFIC_MAX_HOURLY_RANGE_DAYS = 31;

/**
 * Same `start` / `end` rules as `CommonAnalyticsQuery` (≤ 365 days, not in
 * the future), without `websiteIds`: counted per tenant, not per website.
 */
export class CrawlerTrafficQueryDto {
  @ApiProperty({
    description:
      'ISO-8601 start. Rounded down to the UTC hour: the counts have 1-hour resolution.',
    example: '2026-11-10T00:00:00Z',
    required: true,
  })
  @IsString()
  @IsNotEmpty({ message: 'start is required' })
  @IsISO8601(
    { strict: true },
    { message: 'start must be a valid ISO-8601 timestamp' },
  )
  start: string;

  @ApiProperty({
    description:
      'ISO-8601 end (inclusive: the hour containing it is included). Must be ≥ start, not in the future, and within 365 days of start.',
    example: '2026-11-17T23:59:59Z',
    required: true,
  })
  @IsString()
  @IsNotEmpty({ message: 'end is required' })
  @IsISO8601(
    { strict: true },
    { message: 'end must be a valid ISO-8601 timestamp' },
  )
  @Validate(AnalyticsDateRangeConstraint)
  end: string;

  @ApiProperty({
    description: `Series bucket size. \`hour\` is allowed for ranges up to ${CRAWLER_TRAFFIC_MAX_HOURLY_RANGE_DAYS} days.`,
    enum: CRAWLER_TRAFFIC_GRANULARITIES,
    required: false,
    default: 'day',
  })
  @IsOptional()
  @IsIn(CRAWLER_TRAFFIC_GRANULARITIES)
  granularity?: CrawlerTrafficGranularity;
}
