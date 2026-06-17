import { ApiProperty } from '@nestjs/swagger';
import type { AnalyticsMetrics } from '../types';

export class AnalyticsMetricsResponse implements AnalyticsMetrics {
  @ApiProperty({
    description: 'Total number of search queries performed',
    example: 500,
  })
  searches: number;

  @ApiProperty({
    description: 'Total number of resource detail views',
    example: 300,
  })
  resourceViews: number;

  @ApiProperty({
    description: 'Number of searches that returned zero results',
    example: 45,
  })
  zeroResults: number;

  @ApiProperty({
    description: 'Number of times directions were requested',
    example: 80,
  })
  directions: number;

  @ApiProperty({
    description: 'Number of phone call interactions initiated',
    example: 60,
  })
  phoneCalls: number;

  @ApiProperty({
    description: 'Number of website link clicks from resource listings',
    example: 120,
  })
  websiteClicks: number;

  @ApiProperty({
    description: 'Number of searches performed via the embedded widget',
    example: 150,
  })
  widgetSearches: number;

  @ApiProperty({
    description: 'Number of callout/banner link clicks',
    example: 35,
  })
  calloutClicks: number;

  @ApiProperty({
    description: 'Number of times users switched language',
    example: 12,
  })
  languageSwitches: number;

  @ApiProperty({
    description: 'Number of times a resource was viewed via an event',
    example: 30,
  })
  resourceViewed: number;
}
