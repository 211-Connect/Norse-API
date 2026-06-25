import { ApiProperty } from '@nestjs/swagger';
import type { Stats } from '../types';

export class StatsResponse implements Stats {
  @ApiProperty({
    description: 'Number of bounces',
    example: 100,
  })
  bounces: number;

  @ApiProperty({
    description: 'Number of pageviews',
    example: 1000,
  })
  pageviews: number;

  @ApiProperty({
    description: 'Total time spent on site in seconds',
    example: 3600,
  })
  totaltime: number;

  @ApiProperty({
    description: 'Number of unique visitors',
    example: 200,
  })
  visitors: number;

  @ApiProperty({
    description: 'Number of visits',
    example: 250,
  })
  visits: number;

  @ApiProperty({
    description: 'Comparison stats for the previous period',
  })
  comparison: {
    bounces: number;
    pageviews: number;
    totaltime: number;
    visitors: number;
    visits: number;
  };
}
