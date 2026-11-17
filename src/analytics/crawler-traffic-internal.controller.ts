import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
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

import { NotTenantScoped } from '../auth/gateway/gateway-principal';
import { InternalApiGuard } from '../common/guards/internal-api.guard';
import { X_TENANT_ID_HEADER_DESCRIPTION } from '../common/swagger/header-descriptions';
import {
  CrawlerTrafficAllTenantsResponse,
  CrawlerTrafficQueryDto,
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
@Controller({ path: 'internal/crawler-traffic', version: '1' })
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

/**
 * Cross-tenant read for Norse's super-admin analytics view. Not tenant
 * scoped, so it is a separate controller kept out of TenantMiddleware;
 * Norse checks the super-admin role before calling it.
 */
@ApiTags('Crawler Traffic (Internal)')
@NotTenantScoped()
@UseGuards(InternalApiGuard)
@ApiSecurity('x-internal-api-key')
@Controller({ path: 'internal/crawler-traffic-all-tenants', version: '1' })
export class CrawlerTrafficAllTenantsInternalController {
  constructor(private readonly crawlerTrafficService: CrawlerTrafficService) {}

  @Get()
  @ApiOkResponse({ type: CrawlerTrafficAllTenantsResponse })
  @ApiOperation({
    summary: 'Get per-crawler request counts across all tenants',
    description:
      'Totals, top crawlers, an hour or day series and a per-tenant breakdown. For super admins only (Norse checks the role).',
  })
  getAllTenants(
    @Query() query: CrawlerTrafficQueryDto,
  ): Promise<CrawlerTrafficAllTenantsResponse> {
    return this.crawlerTrafficService.getAllTenantsStats(
      query.start,
      query.end,
      query.granularity ?? 'day',
    );
  }
}
