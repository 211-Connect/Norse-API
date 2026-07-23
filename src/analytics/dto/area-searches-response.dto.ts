import { ApiProperty } from '@nestjs/swagger';
import type { AreaMetricsRow as IAreaMetricsRow } from '../types';

class AreaMetricsRow implements IAreaMetricsRow {
  @ApiProperty({
    description: 'Area identifier (ZIP code or county name)',
    example: '55101',
  })
  area: string;

  @ApiProperty({
    description: 'Total number of searches in this area',
    example: 50,
  })
  totalSearches: number;

  @ApiProperty({
    description: 'Number of searches that returned zero results in this area',
    example: 5,
  })
  zeroSearches: number;

  @ApiProperty({
    description: 'Ratio of zero-result searches to total searches',
    example: 0.1,
  })
  zeroRate: number;
}

export class AreaSearchesResponse {
  @ApiProperty({
    description: 'Metrics grouped by ZIP code',
    type: [AreaMetricsRow],
  })
  zipCodeRows: AreaMetricsRow[];

  @ApiProperty({
    description: 'Metrics grouped by county',
    type: [AreaMetricsRow],
  })
  countyRows: AreaMetricsRow[];
}
