import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  BLOCKED_TRAFFIC_CLASSIFICATIONS,
  type BlockedTrafficClassification,
} from '../../common/schemas/blocked-traffic-hourly.schema';
import {
  CRAWLER_TRAFFIC_OUTCOMES,
  type CrawlerTrafficOutcome,
} from '../../common/schemas/crawler-traffic-hourly.schema';

/** Max buckets in one push. */
export const CRAWLER_TRAFFIC_MAX_BUCKETS_PER_PUSH = 1000;
/** Max count in one bucket of one push; far above one instance's minute. */
export const CRAWLER_TRAFFIC_MAX_BUCKET_COUNT = 10_000_000;
/** Arcjet bot names are upper-case identifiers, e.g. `AHREFS_CRAWLER`. */
export const CRAWLER_NAME_PATTERN = /^[A-Z0-9_]*$/;

export class CrawlerTrafficBucketDto {
  @ApiProperty({
    description:
      'Start of the UTC hour the requests fall in (minutes, seconds and milliseconds must be zero). At most 7 days old and not in the future.',
    example: '2026-11-17T14:00:00.000Z',
  })
  @IsISO8601({ strict: true })
  hour: string;

  @ApiProperty({
    description:
      'Arcjet bot name, e.g. `AHREFS_CRAWLER`. Empty when no crawler was identified (unidentified client, or a load-limit 429).',
    example: 'AHREFS_CRAWLER',
    maxLength: 64,
  })
  @IsString()
  @MaxLength(64)
  @Matches(CRAWLER_NAME_PATTERN)
  crawler: string;

  @ApiProperty({
    description:
      'blocked: 403 from bot protection. logged: denied on an observe-only host, served. rate_limited: 403 from the per-IP rate limit. allowed: an allowed crawler, served. shed: 429 from the per-tenant load limit.',
    enum: CRAWLER_TRAFFIC_OUTCOMES,
    example: 'blocked',
  })
  @IsIn(CRAWLER_TRAFFIC_OUTCOMES)
  outcome: CrawlerTrafficOutcome;

  @ApiProperty({
    description: 'Classification from Norse `classifyBlockedTraffic`.',
    enum: BLOCKED_TRAFFIC_CLASSIFICATIONS,
    example: 'seo',
  })
  @IsIn(BLOCKED_TRAFFIC_CLASSIFICATIONS)
  classification: BlockedTrafficClassification;

  @ApiProperty({
    description: 'Requests to add to the bucket.',
    minimum: 1,
    maximum: CRAWLER_TRAFFIC_MAX_BUCKET_COUNT,
    example: 42,
  })
  @IsInt()
  @Min(1)
  @Max(CRAWLER_TRAFFIC_MAX_BUCKET_COUNT)
  count: number;
}

export class RecordCrawlerTrafficDto {
  @ApiProperty({
    description: `Per-bucket deltas for the tenant in x-tenant-id (max ${CRAWLER_TRAFFIC_MAX_BUCKETS_PER_PUSH}).`,
    type: [CrawlerTrafficBucketDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CRAWLER_TRAFFIC_MAX_BUCKETS_PER_PUSH)
  @ValidateNested({ each: true })
  @Type(() => CrawlerTrafficBucketDto)
  buckets: CrawlerTrafficBucketDto[];
}

export class RecordCrawlerTrafficResponseDto {
  @ApiProperty({
    description: 'Requests added across all buckets.',
    example: 42,
  })
  recorded: number;
}
