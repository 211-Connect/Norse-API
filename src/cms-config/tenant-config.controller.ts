import { Controller, Get, Param, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags, ApiParam, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { TenantConfigService } from './tenant-config.service';
import {
  AllTenantConfigResponseDto,
  SuggestionsConfigResponseDto,
  TopicsConfigResponseDto,
} from './dto';

@ApiTags('Tenant Config')
@Controller({ path: 'tenant-config', version: VERSION_NEUTRAL })
export class TenantConfigController {
  constructor(private readonly tenantConfigService: TenantConfigService) {}

  @Get(':tenantId/topics')
  @ApiOperation({ summary: 'Get tenant topics configuration' })
  @ApiParam({
    name: 'tenantId',
    required: true,
    description: 'Tenant ID to fetch topics configuration for',
    example: '1',
  })
  @ApiResponse({
    status: 200,
    description: 'Topics configuration for the specified tenant',
    type: TopicsConfigResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Failed to retrieve topics configuration',
  })
  async getTopics(
    @Param('tenantId') tenantId: string,
  ): Promise<TopicsConfigResponseDto> {
    return this.tenantConfigService.getTopics(tenantId);
  }

  @Get(':tenantId/suggestions')
  @ApiOperation({ summary: 'Get tenant suggestions configuration' })
  @ApiParam({
    name: 'tenantId',
    required: true,
    description: 'Tenant ID to fetch suggestions configuration for',
    example: '1',
  })
  @ApiResponse({
    status: 200,
    description: 'Suggestions configuration for the specified tenant',
    type: SuggestionsConfigResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or missing internal API key',
  })
  @ApiResponse({
    status: 500,
    description: 'Failed to retrieve suggestions configuration',
  })
  async getSuggestions(
    @Param('tenantId') tenantId: string,
  ): Promise<SuggestionsConfigResponseDto> {
    return this.tenantConfigService.getSuggestions(tenantId);
  }

  @Get(':tenantId')
  @ApiOperation({ summary: 'Get full tenant configuration aggregate' })
  @ApiParam({
    name: 'tenantId',
    required: true,
    description:
      'Tenant ID to fetch complete configuration for (locales, facets, topics, suggestions, hybrid search, orchestration)',
    example: '1',
  })
  @ApiResponse({
    status: 200,
    description: 'Complete tenant configuration aggregate',
    type: AllTenantConfigResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or missing internal API key',
  })
  @ApiResponse({
    status: 500,
    description: 'Failed to retrieve tenant configuration aggregate',
  })
  async getAllTenantConfig(
    @Param('tenantId') tenantId: string,
  ): Promise<AllTenantConfigResponseDto> {
    const [
      locales,
      facets,
      topics,
      suggestions,
      hybridSearchConfig,
      orchestrationConfig,
    ] = await Promise.all([
      this.tenantConfigService.getTenantLocales(tenantId),
      this.tenantConfigService.getFacets(tenantId),
      this.tenantConfigService.getTopics(tenantId),
      this.tenantConfigService.getSuggestions(tenantId),
      this.tenantConfigService.getSearchConfig(tenantId),
      this.tenantConfigService.getOrchestrationConfig(tenantId),
    ]);

    return {
      locales,
      facets,
      topics,
      suggestions,
      hybridSearchConfig,
      orchestrationConfig,
    };
  }
}
