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
  @ApiProperty({ required: false, example: 'WA' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/)
  state?: string;

  @ApiProperty({ required: false, default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiProperty({
    required: false,
    description: 'Cursor from the preceding page with the same state filter.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @Matches(/^[A-Za-z0-9_-]+$/)
  cursor?: string;
}

export class PlaceSlugParamDto {
  @ApiProperty({ example: 'spokane-wa' })
  @IsString()
  @MaxLength(512)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug: string;
}

export class PlaceSummaryDto {
  @ApiProperty({ example: 'place:5367000' })
  id: string;
  @ApiProperty({ example: 'Spokane' })
  name: string;
  @ApiProperty({ example: 'WA' })
  state: string;
  @ApiProperty({ example: 'spokane-wa' })
  slug: string;
  @ApiProperty({ example: 'city' })
  place_type: string;
}

export class PlaceListDto {
  @ApiProperty({ type: [PlaceSummaryDto] })
  items: PlaceSummaryDto[];
  @ApiProperty({ type: String, nullable: true })
  next_cursor: string | null;
}

export class PlaceDetailDto extends PlaceSummaryDto {
  @ApiProperty({ enum: ['place'] })
  type: 'place';
  @ApiProperty({ example: '5367000' })
  fips: string;
  @ApiProperty({ example: '25' })
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
    type: 'object',
    additionalProperties: true,
    description: 'GeoJSON Polygon or MultiPolygon in longitude/latitude order.',
  })
  geometry: Record<string, unknown>;
}
