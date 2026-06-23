import { ApiProperty } from '@nestjs/swagger';
import type { PageviewEntry } from '../types';

export class PageviewsResponse implements PageviewEntry {
  @ApiProperty({
    description: 'Date of the pageviews',
    example: '2025-01-01',
  })
  date: string;

  @ApiProperty({
    description: 'Number of page views on this date',
    example: 320,
  })
  hits: number;
}
