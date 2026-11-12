import { ApiProperty } from '@nestjs/swagger';
import { PhysicalAddressDto } from './search-response.dto';

export class SearchPinDto {
  @ApiProperty({ description: 'Document id, the same `_id` as a list hit.' })
  id: string;

  @ApiProperty({ nullable: true, type: String })
  service_at_location_id: string | null;

  @ApiProperty({ nullable: true, type: String })
  name: string | null;

  @ApiProperty({ type: PhysicalAddressDto, nullable: true })
  physical_address: PhysicalAddressDto | null;

  @ApiProperty({
    type: [Number],
    minItems: 2,
    maxItems: 2,
    description: 'Longitude, latitude',
    example: [-77.43, 37.54],
  })
  coordinates: [number, number];
}

export class SearchPinsResponseDto {
  @ApiProperty({
    description:
      'Located documents matching the search. Classic search counts up to 10000.',
  })
  total: number;

  @ApiProperty({ description: 'Whether matches past the pin limit were cut.' })
  truncated: boolean;

  @ApiProperty({ type: [SearchPinDto] })
  pins: SearchPinDto[];
}
