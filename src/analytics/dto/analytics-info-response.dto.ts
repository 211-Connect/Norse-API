import { ApiProperty } from '@nestjs/swagger';

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
}
