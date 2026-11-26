import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';

import { InternalApiGuard } from '../common/guards/internal-api.guard';
import { X_TENANT_ID_HEADER_DESCRIPTION } from '../common/swagger/header-descriptions';
import { V1_AND_LEGACY } from '../common/versioning/api-version';
import {
  RecordCrawlerTrafficDto,
  RecordCrawlerTrafficResponseDto,
} from './dto';
import { CrawlerTrafficService } from './services/crawler-traffic.service';

/**
 * Service-to-service ingest for Norse's per-crawler counters. Guarded by
 * the internal API key; every push is scoped to the tenant in
 * `x-tenant-id` (validated by TenantMiddleware).
 */
@ApiTags('Crawler Traffic (Internal)')
@UseGuards(InternalApiGuard)
@ApiSecurity('x-internal-api-key')
@Controller({ path: 'internal/crawler-traffic', version: V1_AND_LEGACY })
@ApiHeader({
  name: 'x-tenant-id',
  required: true,
  description: X_TENANT_ID_HEADER_DESCRIPTION,
})
export class CrawlerTrafficInternalController {
  constructor(private readonly crawlerTrafficService: CrawlerTrafficService) {}

  @Post()
  @HttpCode(200)
  @ApiOkResponse({ type: RecordCrawlerTrafficResponseDto })
  @ApiOperation({
    summary: 'Add per-crawler request counts for the tenant',
    description:
      'Adds per-hour deltas aggregated by a Norse instance. Additive: two pushes for the same bucket are summed.',
  })
  async record(
    @Body() payload: RecordCrawlerTrafficDto,
    @Req() request: Request,
  ): Promise<RecordCrawlerTrafficResponseDto> {
    const recorded = await this.crawlerTrafficService.record(
      request.tenantId,
      payload.buckets,
    );
    return { recorded };
  }
}
