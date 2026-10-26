import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  BLOCKED_TRAFFIC_CLASSIFICATIONS,
  type BlockedTrafficClassification,
} from '../../common/schemas/blocked-traffic-hourly.schema';

/** Max buckets in one push: tenant hours × 3 classifications × 2 modes. */
export const BLOCKED_TRAFFIC_MAX_BUCKETS_PER_PUSH = 500;
/** Max count in one bucket of one push; far above one instance's minute. */
export const BLOCKED_TRAFFIC_MAX_BUCKET_COUNT = 10_000_000;

export class BlockedTrafficBucketDto {
  @ApiProperty({
    description:
      'Start of the UTC hour the denials fall in (minutes, seconds and milliseconds must be zero). At most 7 days old and not in the future.',
    example: '2026-10-22T14:00:00.000Z',
  })
  @IsISO8601({ strict: true })
  hour: string;

  @ApiProperty({
    description: 'Classification from Norse `classifyBlockedTraffic`.',
    enum: BLOCKED_TRAFFIC_CLASSIFICATIONS,
    example: 'nefarious',
  })
  @IsIn(BLOCKED_TRAFFIC_CLASSIFICATIONS)
  classification: BlockedTrafficClassification;

  @ApiProperty({
    description:
      'true: the request got a 403. false: observe-only host, the request was detected but served.',
    example: true,
  })
  @IsBoolean()
  enforced: boolean;

  @ApiProperty({
    description: 'Denials to add to the bucket.',
    minimum: 1,
    maximum: BLOCKED_TRAFFIC_MAX_BUCKET_COUNT,
    example: 42,
  })
  @IsInt()
  @Min(1)
  @Max(BLOCKED_TRAFFIC_MAX_BUCKET_COUNT)
  count: number;
}

export class RecordBlockedTrafficDto {
  @ApiProperty({
    description: `Per-bucket deltas for the tenant in x-tenant-id (max ${BLOCKED_TRAFFIC_MAX_BUCKETS_PER_PUSH}).`,
    type: [BlockedTrafficBucketDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BLOCKED_TRAFFIC_MAX_BUCKETS_PER_PUSH)
  @ValidateNested({ each: true })
  @Type(() => BlockedTrafficBucketDto)
  buckets: BlockedTrafficBucketDto[];
}

export class RecordBlockedTrafficResponseDto {
  @ApiProperty({
    description: 'Denials added across all buckets.',
    example: 42,
  })
  recorded: number;
}
