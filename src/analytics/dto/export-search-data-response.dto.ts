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
    description: 'Search coordinates in "longitude,latitude" format',
    example: '-122.4194,37.7749',
    nullable: true,
  })
  coordinates: string | null;

  @ApiProperty({
    description: 'ZIP/postal code from reverse geocoding',
    example: '94102',
    nullable: true,
  })
  zipCode: string | null;
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
