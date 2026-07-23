import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  Version,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

import { AnalyticsConfigService } from './services/analytics-config.service';
import { AnalyticsInfoEnricherService } from './services/analytics-info-enricher.service';
import { UmamiAnalyticsService } from './services/umami-analytics.service';
import {
  AnalyticsApiKeyGuard,
  ANALYTICS_API_KEY_HEADER,
  TENANT_ID_HEADER,
} from './guards/analytics-api-key.guard';
import {
  AnalyticsInfoResponse,
  AnalyticsMetricsResponse,
  AreaSearchesResponse,
  CommonAnalyticsQuery,
  EventCatalogEntryResponse,
  EventValuesQueryDto,
  EventValuesResponse,
  ExportSearchDataQueryDto,
  ExportSearchDataResponse,
  HeatmapPointResponse,
  LanguageSwitchesResponse,
  PageviewsResponse,
  PaginatedSessionsResponse,
  ResourceByEntryResponse,
  ResourceMetricsResponse,
  SearchesResponse,
  SendBatchDto,
  SendBatchResponseDto,
  SendEventDto,
  SendEventResponseDto,
  SessionsQueryDto,
  StatsResponse,
  TimezoneAnalyticsQueryDto,
  ZeroResultQueriesResponse,
} from './dto';
import { AnalyticsCdnCacheInterceptor } from './interceptors/analytics-cdn-cache.interceptor';
import { SetCdnCacheTTL } from '../common/decorators/cdn-cache-ttl.decorator';
import { ANALYTICS_CDN_TTL_OPEN_RANGE_S } from './internal/constants';

@ApiTags('Analytics')
@Controller('analytics')
@UseGuards(AnalyticsApiKeyGuard)
@UseInterceptors(AnalyticsCdnCacheInterceptor)
@ApiSecurity('x-analytics-api-key')
@ApiHeader({
  name: 'x-api-version',
  description: 'API version',
  required: true,
  schema: { default: '1' },
})
@ApiHeader({
  name: TENANT_ID_HEADER,
  description: 'Tenant ID',
  required: true,
})
@ApiHeader({
  name: ANALYTICS_API_KEY_HEADER,
  description: 'Analytics API key for the tenant',
  required: true,
})
export class AnalyticsController {
  constructor(
    private readonly umamiAnalyticsService: UmamiAnalyticsService,
    private readonly analyticsConfigService: AnalyticsConfigService,
    private readonly infoEnricher: AnalyticsInfoEnricherService,
  ) {}

  @Get('info')
  @Version('1')
  @ApiOperation({
    summary: 'Get analytics configuration for the authenticated tenant',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved analytics configuration',
    type: AnalyticsInfoResponse,
  })
  async getInfo(
    @Headers(TENANT_ID_HEADER) tenantId: string,
  ): Promise<AnalyticsInfoResponse> {
    const config = await this.analyticsConfigService.getConfig(tenantId);
    const rootWebsiteId = config?.umamiWebsiteId ?? '';
    const additionalWebsiteIds =
      config?.additionalWebsiteIds
        .map((entry) => entry?.websiteId)
        .filter(
          (id): id is string => typeof id === 'string' && id.length > 0,
        ) ?? [];

    let websites: { id: string; name: string }[] = [];
    if (config) {
      websites = await this.infoEnricher.getWebsiteNames(tenantId, config);
    }

    return {
      rootWebsiteId,
      additionalWebsiteIds,
      websites,
    };
  }

  @Get('stats')
  @Version('1')
  @ApiOperation({
    summary: 'Get analytics basic stats',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved analytics stats',
    type: StatsResponse,
  })
  async getStats(
    @Headers(TENANT_ID_HEADER) tenantId: string,
    @Query() query: CommonAnalyticsQuery,
  ): Promise<StatsResponse> {
    const websiteIds = await this.analyticsConfigService.getWebsiteIds(
      tenantId,
      query.websiteIds,
    );
    return this.umamiAnalyticsService.getStats({
      tenantId,
      start: query.start,
      end: query.end,
      websiteIds,
    });
  }

  @Get('pageviews')
  @Version('1')
  @ApiOperation({
    summary: 'Get pageview metrics per day',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved pageview metrics',
    type: [PageviewsResponse],
  })
  async getPageviews(
    @Headers(TENANT_ID_HEADER) tenantId: string,
    @Query() query: TimezoneAnalyticsQueryDto,
  ): Promise<PageviewsResponse[]> {
    const websiteIds = await this.analyticsConfigService.getWebsiteIds(
      tenantId,
      query.websiteIds,
    );
    return this.umamiAnalyticsService.getPageviews({
      tenantId,
      start: query.start,
      end: query.end,
      websiteIds,
      unit: 'day',
      timezone: query.timezone,
    });
  }

  @Get('metrics')
  @Version('1')
  @ApiOperation({
    summary: 'Get aggregated analytics metrics',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved analytics metrics',
    type: AnalyticsMetricsResponse,
  })
  async getMetrics(
    @Headers(TENANT_ID_HEADER) tenantId: string,
    @Query() query: TimezoneAnalyticsQueryDto,
  ): Promise<AnalyticsMetricsResponse> {
    const websiteIds = await this.analyticsConfigService.getWebsiteIds(
      tenantId,
      query.websiteIds,
    );
    return this.umamiAnalyticsService.getMetrics({
      tenantId,
      start: query.start,
      end: query.end,
      websiteIds,
      timezone: query.timezone,
    });
  }

  @Get('resource-metrics')
  @Version('1')
  @ApiOperation({
    summary: 'Get pageview metrics per resource',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved resource metrics',
    type: [ResourceMetricsResponse],
  })
  async getResourceMetrics(
    @Headers(TENANT_ID_HEADER) tenantId: string,
    @Query() query: CommonAnalyticsQuery,
  ): Promise<ResourceMetricsResponse[]> {
    const websiteIds = await this.analyticsConfigService.getWebsiteIds(
      tenantId,
      query.websiteIds,
    );
    return this.umamiAnalyticsService.getResourceMetrics({
      tenantId,
      start: query.start,
      end: query.end,
      websiteIds,
    });
  }

  @Get('searches')
  @Version('1')
  @ApiOperation({
    summary: 'Get number of all search queries grouped by query type',
  })
  @ApiResponse({
    status: 200,
    type: SearchesResponse,
  })
  async getSearches(
    @Headers(TENANT_ID_HEADER) tenantId: string,
    @Query() query: CommonAnalyticsQuery,
  ): Promise<SearchesResponse> {
    const websiteIds = await this.analyticsConfigService.getWebsiteIds(
      tenantId,
      query.websiteIds,
    );
    return this.umamiAnalyticsService.getSearches({
      tenantId,
      start: query.start,
      end: query.end,
      websiteIds,
    });
  }

  @Get('zero-result-queries')
  @Version('1')
  @ApiOperation({
    summary: 'Get search queries that returned zero results',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved zero-result query metrics',
    type: [ZeroResultQueriesResponse],
  })
  async getZeroResultQueries(
    @Headers(TENANT_ID_HEADER) tenantId: string,
    @Query() query: CommonAnalyticsQuery,
  ): Promise<ZeroResultQueriesResponse[]> {
    const websiteIds = await this.analyticsConfigService.getWebsiteIds(
      tenantId,
      query.websiteIds,
    );
    return this.umamiAnalyticsService.getZeroResultQueries({
      tenantId,
      start: query.start,
      end: query.end,
      websiteIds,
    });
  }

  @Get('language-switches')
  @Version('1')
  @ApiOperation({
    summary: 'Get metrics for language switch destination pages',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved language switch metrics',
    type: [LanguageSwitchesResponse],
  })
  async getLanguageSwitches(
    @Headers(TENANT_ID_HEADER) tenantId: string,
    @Query() query: CommonAnalyticsQuery,
  ): Promise<LanguageSwitchesResponse[]> {
    const websiteIds = await this.analyticsConfigService.getWebsiteIds(
      tenantId,
      query.websiteIds,
    );
    return this.umamiAnalyticsService.getLanguageSwitches({
      tenantId,
      start: query.start,
      end: query.end,
      websiteIds,
    });
  }

  @Get('resource-by-entry')
  @Version('1')
  @ApiOperation({
    summary: 'Get resource view metrics grouped by entry page',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved resource-by-entry metrics',
    type: [ResourceByEntryResponse],
  })
  async getResourceByEntry(
    @Headers(TENANT_ID_HEADER) tenantId: string,
    @Query() query: CommonAnalyticsQuery,
  ): Promise<ResourceByEntryResponse[]> {
    const websiteIds = await this.analyticsConfigService.getWebsiteIds(
      tenantId,
      query.websiteIds,
    );
    return this.umamiAnalyticsService.getResourceByEntry({
      tenantId,
      start: query.start,
      end: query.end,
      websiteIds,
    });
  }

  @Get('sessions')
  @Version('1')
  @ApiOperation({
    summary: 'Get visitor sessions',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved visitor sessions',
    type: PaginatedSessionsResponse,
  })
  async getSessions(
    @Headers(TENANT_ID_HEADER) tenantId: string,
    @Query() query: SessionsQueryDto,
  ): Promise<PaginatedSessionsResponse> {
    const websiteIds = await this.analyticsConfigService.getWebsiteIds(
      tenantId,
      query.websiteIds,
    );
    return this.umamiAnalyticsService.getSessions({
      tenantId,
      start: query.start,
      end: query.end,
      websiteIds,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('export-search-data')
  @Version('1')
  @ApiOperation({
    summary: 'Get detailed search event data for CSV export',
    description:
      'Returns search events with timestamps, coordinates, and ZIP codes.',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved export data',
    type: ExportSearchDataResponse,
  })
  async getExportSearchData(
    @Headers(TENANT_ID_HEADER) tenantId: string,
    @Query() query: ExportSearchDataQueryDto,
  ): Promise<ExportSearchDataResponse> {
    const websiteIds = await this.analyticsConfigService.getWebsiteIds(
      tenantId,
      query.websiteIds,
    );
    return this.umamiAnalyticsService.getExportSearchData({
      tenantId,
      start: query.start,
      end: query.end,
      websiteIds,
    });
  }

  @Get('heatmap')
  @Version('1')
  @SetCdnCacheTTL(ANALYTICS_CDN_TTL_OPEN_RANGE_S)
  @ApiOperation({
    summary: 'Get search heatmap points',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved heatmap points',
    type: [HeatmapPointResponse],
  })
  async getHeatmap(
    @Headers(TENANT_ID_HEADER) tenantId: string,
    @Query() query: CommonAnalyticsQuery,
  ): Promise<HeatmapPointResponse[]> {
    const websiteIds = await this.analyticsConfigService.getWebsiteIds(
      tenantId,
      query.websiteIds,
    );
    return this.umamiAnalyticsService.getHeatmap({
      tenantId,
      start: query.start,
      end: query.end,
      websiteIds,
    });
  }

  @Get('area-searches')
  @Version('1')
  @SetCdnCacheTTL(ANALYTICS_CDN_TTL_OPEN_RANGE_S)
  @ApiOperation({
    summary: 'Get search metrics grouped by ZIP code and county',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved area search metrics',
    type: AreaSearchesResponse,
  })
  async getAreaSearches(
    @Headers(TENANT_ID_HEADER) tenantId: string,
    @Query() query: CommonAnalyticsQuery,
  ): Promise<AreaSearchesResponse> {
    const websiteIds = await this.analyticsConfigService.getWebsiteIds(
      tenantId,
      query.websiteIds,
    );
    return this.umamiAnalyticsService.getAreaSearches({
      tenantId,
      start: query.start,
      end: query.end,
      websiteIds,
    });
  }

  @Get('event-values')
  @Version('1')
  @ApiOperation({
    summary: 'Get distinct values for an event property',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved event values',
    type: [EventValuesResponse],
  })
  async getEventValues(
    @Headers(TENANT_ID_HEADER) tenantId: string,
    @Query() query: EventValuesQueryDto,
  ): Promise<EventValuesResponse[]> {
    const websiteIds = await this.analyticsConfigService.getWebsiteIds(
      tenantId,
      query.websiteIds,
    );
    return this.umamiAnalyticsService.getEventValues({
      tenantId,
      start: query.start,
      end: query.end,
      websiteIds,
      event: query.event,
      property: query.property,
    });
  }

  @Get('event-catalog')
  @Version('1')
  @ApiOperation({
    summary: 'Get available events and their properties for the tenant',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved event catalog',
    type: [EventCatalogEntryResponse],
  })
  async getEventCatalog(
    @Headers(TENANT_ID_HEADER) tenantId: string,
  ): Promise<EventCatalogEntryResponse[]> {
    const websiteIds =
      await this.analyticsConfigService.getWebsiteIds(tenantId);
    return this.umamiAnalyticsService.getEventCatalog({
      tenantId,
      websiteIds,
    });
  }

  @Post('events')
  @Version('1')
  @ApiOperation({
    summary: 'Send a custom event to Umami',
  })
  @ApiResponse({
    status: 200,
    description: 'Event sent successfully',
    type: SendEventResponseDto,
  })
  async sendEvent(
    @Headers(TENANT_ID_HEADER) tenantId: string,
    @Body() dto: SendEventDto,
  ): Promise<SendEventResponseDto> {
    await this.analyticsConfigService.getWebsiteIds(tenantId, [dto.websiteId]);

    await this.umamiAnalyticsService.sendEvent(dto.websiteId, dto.payload);

    return { success: true };
  }

  @Post('events/batch')
  @Version('1')
  @ApiOperation({
    summary: 'Send multiple custom events to Umami in a single request',
  })
  @ApiResponse({
    status: 200,
    description: 'Batch processed',
    type: SendBatchResponseDto,
  })
  async sendBatch(
    @Headers(TENANT_ID_HEADER) tenantId: string,
    @Body() dto: SendBatchDto,
  ): Promise<SendBatchResponseDto> {
    const websiteIds = [...new Set(dto.events.map((event) => event.websiteId))];
    await this.analyticsConfigService.getWebsiteIds(tenantId, websiteIds);

    const result = await this.umamiAnalyticsService.sendBatch(
      dto.events.map((event) => ({
        websiteId: event.websiteId,
        input: event.payload,
      })),
    );

    return {
      success: result.errors === 0,
      processed: result.processed,
      errors: result.errors,
      details: result.details,
    };
  }
}
