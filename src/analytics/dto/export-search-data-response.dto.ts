import { ApiProperty } from '@nestjs/swagger';

export class SearchEventExportRow {
  @ApiProperty({
    description: 'ISO-8601 timestamp of the search event',
    example: '2025-01-15T14:23:45.000Z',
  })
  timestamp: string;

  @ApiProperty({
    description:
      'Anonymized, unique identifier for the user who performed the search. ' +
      'Derived by one-way hashing a client-generated anonymous identifier; ' +
      'contains no personally identifiable information.',
    example: 'a3f9c2b1e4d6f0a8b7c5d3e1',
    nullable: true,
  })
  userId: string | null;

  @ApiProperty({
    description:
      'Anonymized, unique identifier for the browsing session in which the ' +
      'search was performed. Derived by one-way hashing a client-generated ' +
      'anonymous identifier; contains no personally identifiable information.',
    example: 'b7e1d4a9c2f8036e5b1a9d0c',
    nullable: true,
  })
  sessionId: string | null;

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
