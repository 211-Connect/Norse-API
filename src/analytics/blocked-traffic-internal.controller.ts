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
import {
  RecordBlockedTrafficDto,
  RecordBlockedTrafficResponseDto,
} from './dto';
import { BlockedTrafficService } from './services/blocked-traffic.service';

/**
 * Service-to-service ingest for Norse's blocked-traffic counters
 * (ISS-2366). Guarded by the internal API key; every push is scoped to the
 * tenant in `x-tenant-id` (validated by TenantMiddleware).
 */
@ApiTags('Blocked Traffic (Internal)')
@UseGuards(InternalApiGuard)
@ApiSecurity('x-internal-api-key')
@Controller({ path: 'internal/blocked-traffic', version: '1' })
@ApiHeader({
  name: 'x-tenant-id',
  required: true,
  description: X_TENANT_ID_HEADER_DESCRIPTION,
})
export class BlockedTrafficInternalController {
  constructor(private readonly blockedTrafficService: BlockedTrafficService) {}

  @Post()
  @HttpCode(200)
  @ApiOkResponse({ type: RecordBlockedTrafficResponseDto })
  @ApiOperation({
    summary: 'Add blocked-request counts for the tenant',
    description:
      'Adds per-hour deltas aggregated by a Norse instance. Additive: two pushes for the same bucket are summed.',
  })
  async record(
    @Body() payload: RecordBlockedTrafficDto,
    @Req() request: Request,
  ): Promise<RecordBlockedTrafficResponseDto> {
    const recorded = await this.blockedTrafficService.record(
      request.tenantId,
      payload.buckets,
    );
    return { recorded };
  }
}
