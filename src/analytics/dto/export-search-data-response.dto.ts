import { ApiProperty } from '@nestjs/swagger';

export class SearchEventExportRow {
  @ApiProperty({
    description: 'ISO-8601 timestamp of the search event',
    example: '2025-01-15T14:23:45.000Z',
  })
  timestamp: string;

  @ApiProperty({
    description: 'User search query string',
    example: 'homeless shelter',
  })
  queryLabel: string;

  @ApiProperty({
    description: 'Search type: text or taxonomy',
    enum: ['text', 'taxonomy'],
    example: 'text',
  })
  queryType: 'text' | 'taxonomy';

  @ApiProperty({
    description: 'Search ZIP/postal code from reverse geocoding',
    example: '94102',
    nullable: true,
  })
  searchZipCode: string | null;

  @ApiProperty({
    description: 'Search city from reverse geocoding',
    example: 'San Francisco',
    nullable: true,
  })
  searchCity: string | null;

  @ApiProperty({
    description: 'Search latitude coordinate',
    example: 37.7749,
    nullable: true,
  })
  searchLatitude: number | null;

  @ApiProperty({
    description: 'Search longitude coordinate',
    example: -122.5678,
    nullable: true,
  })
  searchLongitude: number | null;

  @ApiProperty({
    description: 'User ZIP/postal code from reverse geocoding',
    example: '94102',
    nullable: true,
  })
  userZipCode: string | null;

  @ApiProperty({
    description: 'User city from reverse geocoding',
    example: 'San Francisco',
    nullable: true,
  })
  userCity: string | null;

  @ApiProperty({
    description: 'User latitude coordinate',
    example: 37.7749,
    nullable: true,
  })
  userLatitude: number | null;

  @ApiProperty({
    description: 'User longitude coordinate',
    example: -122.5678,
    nullable: true,
  })
  userLongitude: number | null;
}

export class ExportSearchDataResponse {
  @ApiProperty({
    description: 'Array of search event export rows',
    type: [SearchEventExportRow],
  })
  data: SearchEventExportRow[];

  @ApiProperty({
    description: 'Total number of exported rows',
    example: 1523,
  })
  totalCount: number;
}
