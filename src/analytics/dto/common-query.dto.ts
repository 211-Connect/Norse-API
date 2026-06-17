import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

import { MAX_RANGE_DAYS, ONE_DAY_MS } from '../internal/constants';

export function parseWebsiteIds(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  );
}

@ValidatorConstraint({ name: 'AnalyticsDateRange', async: false })
export class AnalyticsDateRangeConstraint
  implements ValidatorConstraintInterface
{
  validate(_end: unknown, args: ValidationArguments): boolean {
    const obj = args.object as { start?: string; end?: string };
    const startMs = Date.parse(obj.start ?? '');
    const endMs = Date.parse(obj.end ?? '');

    if (Number.isNaN(startMs) || Number.isNaN(endMs)) return true;

    if (endMs < startMs) return false;

    const now = Date.now();
    const toleranceMs = 1000;
    if (startMs > now + toleranceMs || endMs > now + toleranceMs) return false;

    if (endMs - startMs > MAX_RANGE_DAYS * ONE_DAY_MS) return false;

    return true;
  }

  defaultMessage(args: ValidationArguments): string {
    const obj = args.object as { start?: string; end?: string };
    const startMs = Date.parse(obj.start ?? '');
    const endMs = Date.parse(obj.end ?? '');
    const now = Date.now();

    if (endMs < startMs) return 'end must be on or after start';
    if (startMs > now) return 'start cannot be in the future';
    if (endMs > now) return 'end cannot be in the future';
    if (endMs - startMs > MAX_RANGE_DAYS * ONE_DAY_MS) {
      return `Date range cannot exceed ${MAX_RANGE_DAYS} days`;
    }
    return 'invalid analytics date range';
  }
}

export class CommonAnalyticsQuery {
  @ApiProperty({
    description: 'ISO-8601 start date',
    example: '2025-01-01T00:00:00Z',
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
      'ISO-8601 end date. Must be ≥ start, not in the future, and within 365 days of start.',
    example: '2025-01-31T23:59:59Z',
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
      'Optional comma-separated Umami website IDs to filter by. If omitted, the tenant root website is used.',
    example: 'abc-123,def-456',
    required: false,
    type: String,
  })
  @IsOptional()
  @Transform(({ value }) => parseWebsiteIds(value), { toClassOnly: true })
  websiteIds?: string[];
}

export class TimezoneAnalyticsQueryDto extends CommonAnalyticsQuery {
  @ApiProperty({
    description: 'IANA timezone',
    example: 'UTC',
    default: 'UTC',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  timezone: string = 'UTC';
}
