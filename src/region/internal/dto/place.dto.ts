import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { LatLngDto } from './region-response.dto';

export class PlaceListQueryDto {
  @ApiProperty({
    required: false,
    example: 'WA',
    pattern: '^[A-Z]{2}$',
    description: 'Uppercase state or territory postal code.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/)
  state?: string;

  @ApiProperty({
    type: 'integer',
    required: false,
    default: 25,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiProperty({
    required: false,
    description:
      'Opaque cursor from the preceding page with the same state filter; pagination is not a snapshot.',
    maxLength: 2048,
    pattern: '^[A-Za-z0-9_-]+$',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @Matches(/^[A-Za-z0-9_-]+$/)
  cursor?: string;
}

export class PlaceSlugParamDto {
  @ApiProperty({
    example: 'spokane-wa',
    maxLength: 512,
    pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
  })
  @IsString()
  @MaxLength(512)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug: string;
}

export class PlaceSummaryDto {
  @ApiProperty({
    example: 'place:5367000',
    pattern: '^place:[0-9]{7}$',
    description: 'Stable Region ID containing the seven-digit Census GEOID.',
  })
  id: string;
  @ApiProperty({ example: 'Spokane' })
  name: string;
  @ApiProperty({ example: 'WA' })
  state: string;
  @ApiProperty({
    example: 'spokane-wa',
    description: 'Globally unique current canonical slug.',
  })
  slug: string;
  @ApiProperty({
    example: 'city',
    description:
      'Derived Census classification; known values include city, town, cdp and unknown.',
  })
  place_type: string;
}

export class PlaceListDto {
  @ApiProperty({ type: [PlaceSummaryDto] })
  items: PlaceSummaryDto[];
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Continuation cursor; null on the last page.',
  })
  next_cursor: string | null;
}

export class PlaceDetailDto extends PlaceSummaryDto {
  @ApiProperty({ enum: ['place'] })
  type: 'place';
  @ApiProperty({
    example: '5367000',
    pattern: '^[0-9]{7}$',
    description: 'Seven-digit Census GEOID, including leading zeros.',
  })
  fips: string;
  @ApiProperty({
    example: '25',
    description: 'Raw Census Legal/Statistical Area Description code.',
  })
  lsad: string;
  @ApiProperty({ type: LatLngDto })
  centroid: LatLngDto;
  @ApiProperty({
    type: [Number],
    minItems: 4,
    maxItems: 4,
    description: '[min longitude, min latitude, max longitude, max latitude]',
  })
  bbox: [number, number, number, number];
  @ApiProperty({
    description:
      'GeoJSON Polygon or MultiPolygon in WGS84 longitude/latitude order.',
    oneOf: [
      {
        type: 'object',
        required: ['type', 'coordinates'],
        properties: {
          type: { type: 'string', enum: ['Polygon'] },
          coordinates: {
            type: 'array',
            items: {
              type: 'array',
              items: {
                type: 'array',
                minItems: 2,
                maxItems: 2,
                items: { type: 'number' },
              },
            },
          },
        },
      },
      {
        type: 'object',
        required: ['type', 'coordinates'],
        properties: {
          type: { type: 'string', enum: ['MultiPolygon'] },
          coordinates: {
            type: 'array',
            items: {
              type: 'array',
              items: {
                type: 'array',
                items: {
                  type: 'array',
                  minItems: 2,
                  maxItems: 2,
                  items: { type: 'number' },
                },
              },
            },
          },
        },
      },
    ],
  })
  geometry: Record<string, unknown>;
}
