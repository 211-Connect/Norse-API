import { ApiProperty } from '@nestjs/swagger';

export class AnalyticsWebsiteName {
  @ApiProperty({
    description: 'Umami website ID',
    example: 'abc-123',
  })
  id: string;

  @ApiProperty({
    description: 'Human-readable website name from Umami',
    example: 'My Resource Directory',
  })
  name: string;
}

export class AnalyticsInfoResponse {
  @ApiProperty({
    description: 'Root Umami website ID for this tenant',
    example: 'abc-123',
  })
  rootWebsiteId: string;

  @ApiProperty({
    description: 'Additional website IDs associated with this tenant',
    example: ['def-456', 'ghi-789'],
  })
  additionalWebsiteIds: string[];

  @ApiProperty({
    description: 'Website IDs with display names for the website picker',
    type: [AnalyticsWebsiteName],
  })
  websites: AnalyticsWebsiteName[];
}
