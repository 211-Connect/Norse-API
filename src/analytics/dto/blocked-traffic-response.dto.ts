import { ApiProperty } from '@nestjs/swagger';

import {
  BLOCKED_TRAFFIC_CLASSIFICATIONS,
  type BlockedTrafficClassification,
} from '../../common/schemas/blocked-traffic-hourly.schema';

export class BlockedTrafficClassificationTotalDto {
  @ApiProperty({ enum: BLOCKED_TRAFFIC_CLASSIFICATIONS, example: 'nefarious' })
  classification: BlockedTrafficClassification;

  @ApiProperty({ description: 'Requests that got a 403.', example: 1200 })
  blocked: number;

  @ApiProperty({
    description: 'Requests detected on an observe-only host and served.',
    example: 0,
  })
  notEnforced: number;
}

export class BlockedTrafficHourlyBucketDto {
  @ApiProperty({
    description: 'Start of the UTC hour.',
    example: '2026-10-21T14:00:00.000Z',
  })
  hour: string;

  @ApiProperty({ enum: BLOCKED_TRAFFIC_CLASSIFICATIONS, example: 'seo' })
  classification: BlockedTrafficClassification;

  @ApiProperty({ example: true })
  enforced: boolean;

  @ApiProperty({ example: 17 })
  count: number;
}

export class BlockedTrafficResponse {
  @ApiProperty({
    description: 'Requests that got a 403 in the range.',
    example: 1500,
  })
  blocked: number;

  @ApiProperty({
    description:
      'Requests detected on an observe-only host in the range; served, so not blocked.',
    example: 0,
  })
  notEnforced: number;

  @ApiProperty({
    description: 'Totals per classification; always one entry for each.',
    type: [BlockedTrafficClassificationTotalDto],
  })
  byClassification: BlockedTrafficClassificationTotalDto[];

  @ApiProperty({
    description:
      'Non-empty hourly buckets in the range, oldest first. Only when requested with `hourly=true`.',
    type: [BlockedTrafficHourlyBucketDto],
    required: false,
  })
  hourly?: BlockedTrafficHourlyBucketDto[];
}
