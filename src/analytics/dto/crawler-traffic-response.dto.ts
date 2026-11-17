import { ApiProperty } from '@nestjs/swagger';

import {
  BLOCKED_TRAFFIC_CLASSIFICATIONS,
  type BlockedTrafficClassification,
} from '../../common/schemas/blocked-traffic-hourly.schema';
import { CRAWLER_TRAFFIC_GRANULARITIES } from './crawler-traffic-query.dto';

/** Request counts per outcome. */
export class CrawlerTrafficCountsDto {
  @ApiProperty({ description: '403 from bot protection.', example: 120 })
  blocked: number;

  @ApiProperty({
    description: 'Denied on an observe-only host; the page was served.',
    example: 40,
  })
  logged: number;

  @ApiProperty({ description: '403 from the per-IP rate limit.', example: 5 })
  rateLimited: number;

  @ApiProperty({ description: 'Allowed crawlers, served.', example: 900 })
  allowed: number;

  @ApiProperty({
    description: '429 from the per-tenant load limit.',
    example: 0,
  })
  shed: number;

  @ApiProperty({ description: 'Sum of all outcomes.', example: 1065 })
  total: number;
}

export class CrawlerTrafficByCrawlerDto extends CrawlerTrafficCountsDto {
  @ApiProperty({
    description:
      'Arcjet bot name; empty for requests with no identified crawler (unidentified clients, load-limit 429s).',
    example: 'AHREFS_CRAWLER',
  })
  crawler: string;

  @ApiProperty({ enum: BLOCKED_TRAFFIC_CLASSIFICATIONS, example: 'seo' })
  classification: BlockedTrafficClassification;
}

export class CrawlerTrafficSeriesPointDto extends CrawlerTrafficCountsDto {
  @ApiProperty({
    description: 'Start of the UTC hour or day.',
    example: '2026-11-17T14:00:00.000Z',
  })
  bucket: string;
}

export class CrawlerTrafficByTenantDto extends CrawlerTrafficCountsDto {
  @ApiProperty({ example: '7f4c2a51-0c7e-4b8e-9d0a-2f8a3b1c9e10' })
  tenantId: string;
}

export class CrawlerTrafficResponse {
  @ApiProperty({ enum: CRAWLER_TRAFFIC_GRANULARITIES, example: 'day' })
  granularity: string;

  @ApiProperty({ type: CrawlerTrafficCountsDto })
  totals: CrawlerTrafficCountsDto;

  @ApiProperty({
    description:
      'Per crawler and classification, largest total first (top 100).',
    type: [CrawlerTrafficByCrawlerDto],
  })
  byCrawler: CrawlerTrafficByCrawlerDto[];

  @ApiProperty({
    description: 'Non-empty hour or day buckets in the range, oldest first.',
    type: [CrawlerTrafficSeriesPointDto],
  })
  series: CrawlerTrafficSeriesPointDto[];
}

export class CrawlerTrafficAllTenantsResponse extends CrawlerTrafficResponse {
  @ApiProperty({
    description: 'Per tenant, largest total first.',
    type: [CrawlerTrafficByTenantDto],
  })
  byTenant: CrawlerTrafficByTenantDto[];
}
