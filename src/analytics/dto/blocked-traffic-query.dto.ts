import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Validate,
} from 'class-validator';

import { AnalyticsDateRangeConstraint } from './common-query.dto';

/**
 * Same `start` / `end` rules as `CommonAnalyticsQuery`, without
 * `websiteIds`: blocked traffic is counted per tenant, not per website.
 */
export class BlockedTrafficQueryDto {
  @ApiProperty({
    description:
      'ISO-8601 start. Rounded down to the UTC hour: the counts have 1-hour resolution.',
    example: '2026-10-01T00:00:00Z',
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
    example: '2026-10-21T23:59:59Z',
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
    description:
      'Also return the hourly buckets. Off by default: a 365-day range can hold tens of thousands of them, and totals need none.',
    required: false,
    default: false,
    type: Boolean,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true', {
    toClassOnly: true,
  })
  @IsBoolean()
  hourly?: boolean;
}
