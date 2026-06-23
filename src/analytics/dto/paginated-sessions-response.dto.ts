import { ApiProperty } from '@nestjs/swagger';
import { SessionsResponse } from './sessions-response.dto';

export class PaginatedSessionsResponse {
  @ApiProperty({
    description: 'Current page number',
    example: 1,
  })
  page: number;

  @ApiProperty({
    description: 'Number of sessions per page',
    example: 100,
  })
  limit: number;

  @ApiProperty({
    description: 'Total number of sessions returned on this page',
    example: 42,
  })
  count: number;

  @ApiProperty({
    description: 'List of sessions for the requested page',
    type: [SessionsResponse],
  })
  data: SessionsResponse[];
}
