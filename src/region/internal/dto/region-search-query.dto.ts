import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { REGION_ID_PATTERN, regionIdMessage } from '../region.constants';

export const REGION_TYPES = ['state', 'county', 'zip'] as const;
export type RegionType = (typeof REGION_TYPES)[number];

export const REGION_SEARCH_DEFAULT_LIMIT = 10;
export const REGION_SEARCH_MAX_LIMIT = 25;
export const REGION_SEARCH_MAX_TEXT = 100;
export const REGION_SEARCH_MAX_STATES = 60;

/** `a,b` and repeated `?x=a&x=b` both arrive as one list; blanks are dropped. */
function commaList(uppercase: boolean) {
  return ({ value }: { value: unknown }) => {
    if (value === undefined) return undefined;
    const parts = (Array.isArray(value) ? value : [value])
      .flatMap((v) => (typeof v === 'string' ? v.split(',') : [v]))
      .map((v) => (typeof v === 'string' ? v.trim() : v))
      .filter((v) => v !== '');
    return uppercase
      ? parts.map((v) => (typeof v === 'string' ? v.toUpperCase() : v))
      : parts;
  };
}

export class RegionSearchQueryDto {
  @ApiProperty({
    maxLength: REGION_SEARCH_MAX_TEXT,
    description:
      'Typed text. 1 to 5 digits search ZIPs by prefix; anything else searches Region names.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(REGION_SEARCH_MAX_TEXT)
  q: string;

  @ApiProperty({
    required: false,
    type: String,
    example: 'state,county,zip',
    description: 'Comma-separated Region types to return. Absent means all.',
  })
  @IsOptional()
  @Transform(commaList(false))
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(REGION_TYPES, { each: true })
  types?: RegionType[];

  @ApiProperty({
    required: false,
    type: String,
    example: 'MO,KS',
    description:
      'Comma-separated state codes whose Regions rank higher. A boost, not a filter.',
  })
  @IsOptional()
  @Transform(commaList(true))
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(REGION_SEARCH_MAX_STATES)
  @IsString({ each: true })
  @Matches(/^[A-Z]{2}$/, { each: true })
  states?: string[];

  @ApiProperty({
    required: false,
    default: REGION_SEARCH_DEFAULT_LIMIT,
    minimum: 1,
    maximum: REGION_SEARCH_MAX_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(REGION_SEARCH_MAX_LIMIT)
  limit?: number;
}

export class RegionIdParamDto {
  @ApiProperty({ example: 'county:29095', pattern: REGION_ID_PATTERN.source })
  @IsString()
  @Matches(REGION_ID_PATTERN, { message: regionIdMessage })
  id: string;
}
