import { ApiProperty } from '@nestjs/swagger';
import type { HeatmapPoint } from '../types';

export class HeatmapPointResponse implements HeatmapPoint {
  @ApiProperty({
    description: 'Longitude coordinate',
    example: -122.41942,
  })
  lng: number;

  @ApiProperty({
    description: 'Latitude coordinate',
    example: 37.77493,
  })
  lat: number;

  @ApiProperty({
    description: 'Aggregate weight (number of searches) at this location',
    example: 15,
  })
  weight: number;
}
