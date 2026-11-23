import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export const STATE_REGION_TYPES = ['county', 'place'] as const;
export type StateRegionType = (typeof STATE_REGION_TYPES)[number];

export class StateRegionsQueryDto {
  @ApiProperty({
    example: 'WA',
    pattern: '^[A-Z]{2}$',
    description: 'Uppercase state or territory postal code.',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z]{2}$/)
  state: string;

  @ApiProperty({
    required: false,
    type: String,
    example: 'county,place',
    description:
      'Comma-separated Region types to list: `county`, `place`. Absent means both.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === undefined
      ? undefined
      : (Array.isArray(value) ? value : [value])
          .flatMap((v) => (typeof v === 'string' ? v.split(',') : [v]))
          .map((v) => (typeof v === 'string' ? v.trim() : v))
          .filter((v) => v !== ''),
  )
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(STATE_REGION_TYPES, { each: true })
  types?: StateRegionType[];
}

export class StateRegionDto {
  @ApiProperty({ example: 'place:5370000' })
  id: string;

  @ApiProperty({ enum: STATE_REGION_TYPES })
  type: StateRegionType;

  @ApiProperty({ example: 'Tacoma' })
  name: string;

  @ApiProperty({ example: 'WA' })
  state: string;

  @ApiProperty({
    required: false,
    example: 'tacoma-wa',
    description: 'Places only: the globally unique canonical slug.',
  })
  slug?: string;

  @ApiProperty({
    required: false,
    example: 'city',
    description:
      'Places only: Census classification; known values include city, town, cdp and unknown.',
  })
  place_type?: string;

  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    example: 'county:53053',
    description:
      "Places only: the county that contains the place's centroid; null when none does.",
  })
  county_id?: string | null;
}

export class StateRegionsResponseDto {
  @ApiProperty({
    type: [StateRegionDto],
    description: 'Every listed Region of the state, sorted by name.',
  })
  items: StateRegionDto[];
}
