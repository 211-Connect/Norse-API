import { Controller, Post, Param, HttpCode, UseGuards } from '@nestjs/common';
import { OrchestrationConfigService } from './orchestration-config.service';
import { TenantConfigService } from './tenant-config.service';
import { InternalApiGuard } from '../common/guards/internal-api.guard';
import { ApiTags, ApiResponse, ApiSecurity, ApiParam } from '@nestjs/swagger';

@ApiTags('CMS Config')
@Controller('cms-config')
@UseGuards(InternalApiGuard)
@ApiSecurity('x-internal-api-key')
export class CmsConfigController {
  constructor(
    private readonly orchestrationConfigService: OrchestrationConfigService,
    private readonly tenantConfigService: TenantConfigService,
  ) {}

  @Post('cache/clear')
  @HttpCode(204)
  @ApiResponse({
    status: 204,
    description: 'All in-memory caches cleared successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or missing internal API key',
  })
  async clearAllCaches(): Promise<void> {
    this.orchestrationConfigService.clearCache();
    this.tenantConfigService.clearCache();
  }

  @Post('cache/clear/:tenantId')
  @HttpCode(204)
  @ApiParam({
    name: 'tenantId',
    description: 'Tenant ID to clear cache for',
    example: 'tenant123',
  })
  @ApiResponse({
    status: 204,
    description: 'In-memory cache cleared for the specified tenant',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or missing internal API key',
  })
  async clearTenantCache(@Param('tenantId') tenantId: string): Promise<void> {
    this.orchestrationConfigService.clearCacheForTenant(tenantId);
    this.tenantConfigService.clearCacheForTenant(tenantId);
  }
}
