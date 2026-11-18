import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Query,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import {
  ApiTags,
  ApiParam,
  ApiOperation,
  ApiResponse,
  ApiHeader,
} from '@nestjs/swagger';
import { TenantConfigService } from './tenant-config.service';
import { TenantAppConfigService } from './tenant-app-config.service';
import {
  AllTenantConfigResponseDto,
  SuggestionsConfigResponseDto,
  TenantAppConfigQueryDto,
  TenantAppConfigResponseDto,
  TopicsConfigResponseDto,
} from './dto';

@ApiTags('Tenant Config')
@Controller({ path: 'tenant-config', version: VERSION_NEUTRAL })
export class TenantConfigController {
  constructor(
    private readonly tenantConfigService: TenantConfigService,
    private readonly tenantAppConfigService: TenantAppConfigService,
  ) {}

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

  @Get(':tenantId/app-config')
  @ApiOperation({
    summary: 'Get tenant app config (branding, map, radius, alerts)',
    description:
      "The tenant's theme colors, map center and zoom, default search radius and active alerts, from the AppConfig Payload builds for the Norse website. Cached for up to a minute per tenant and locale.",
  })
  @ApiParam({
    name: 'tenantId',
    required: true,
    description: 'Tenant UUID; must equal the x-tenant-id header',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    required: true,
    description: 'Tenant UUID; must equal the tenantId path parameter',
  })
  @ApiResponse({
    status: 200,
    description: 'App config for the specified tenant',
    type: TenantAppConfigResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'tenantId is not a UUID, does not match x-tenant-id, or the locale is invalid',
  })
  @ApiResponse({ status: 404, description: 'Tenant has no app config' })
  @ApiResponse({ status: 502, description: 'Payload request failed' })
  @ApiResponse({ status: 503, description: 'Payload timed out' })
  async getAppConfig(
    @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
    @Headers('x-tenant-id') headerTenantId: string | undefined,
    @Query() query: TenantAppConfigQueryDto,
  ): Promise<TenantAppConfigResponseDto> {
    if (headerTenantId?.toLowerCase() !== tenantId.toLowerCase()) {
      throw new BadRequestException('tenant_target_mismatch');
    }
    return this.tenantAppConfigService.getAppConfig(
      tenantId,
      query.locale ?? 'en',
    );
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
