import { ApiProperty } from '@nestjs/swagger';
import type { ZeroResultQuery } from '../types';

export class ZeroResultQueriesResponse implements ZeroResultQuery {
  @ApiProperty({
    description: 'Search query string that returned zero results',
    example: 'free wifi',
  })
  query: string;

  @ApiProperty({
    description: 'Number of times this query returned zero results',
    example: 28,
  })
  hits: number;
}
