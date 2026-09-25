import { ApiProperty } from '@nestjs/swagger';
import { REGION_TYPES, RegionType } from './region-search-query.dto';

export class RegionSummaryDto {
  @ApiProperty({ example: 'county:29095' })
  id: string;

  @ApiProperty({ enum: REGION_TYPES })
  type: RegionType;

  @ApiProperty({ example: 'Jackson County, MO' })
  name: string;

  @ApiProperty({ example: 'MO', description: 'Postal code of the state.' })
  state: string;
}

export class RegionSearchResponseDto {
  @ApiProperty({ type: [RegionSummaryDto] })
  items: RegionSummaryDto[];
}

export class RegionAttributionDto {
  @ApiProperty()
  text: string;

  @ApiProperty({ required: false })
  url?: string;
}

export class RegionDetailDto extends RegionSummaryDto {
  @ApiProperty({ required: false, description: 'Counties only.' })
  fips?: string;

  @ApiProperty({ required: false, description: 'ZIPs only.' })
  zip?: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'GeoJSON geometry (Polygon or MultiPolygon).',
  })
  geometry: Record<string, unknown>;

  @ApiProperty({
    type: RegionAttributionDto,
    required: false,
    description: 'Present when the source licence requires it; show it.',
  })
  attribution?: RegionAttributionDto;
}
