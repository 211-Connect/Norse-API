import { ApiProperty } from '@nestjs/swagger';
import type { ResourceMetric } from '../types';

export class ResourceMetricsResponse implements ResourceMetric {
  @ApiProperty({
    description: 'Display name of the resource',
    example: 'Food Bank',
  })
  title: string;

  @ApiProperty({
    description: 'Number of views for this resource',
    example: 142,
  })
  views: number;
}
