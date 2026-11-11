import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
  Version,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CustomHeaders } from '../../common/decorators/CustomHeaders';
import { ApiLocaleQuery, ApiTenantIdQuery } from '../../common/decorators';
import { HeadersDto, headersSchema } from '../../common/dto/headers.dto';
import { ArcjetGuard } from '../../common/guards/arcjet.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation-pipe';
import { X_TENANT_ID_HEADER_DESCRIPTION } from '../../common/swagger/header-descriptions';
import {
  UsageMetricsService,
  searchOutcomeFromHits,
} from '../../metrics/usage-metrics.service';
import { V2SearchQueryDto } from './dto/v2-search-query.dto';
import { V2SearchResponseDto } from './dto/v2-search-response.dto';
import { V2SearchEnabledGuard } from './v2-search-enabled.guard';
import { V2SearchService } from './v2-search.service';

/**
 * Reached by `GET /v2/search` (the `/v2/` path selects version 2) and by
 * `GET /search` with `x-api-version: 2`. No CDN cache decorator: a response
 * whose emergency status is an error must not be cached, and that cache rule
 * is not written yet.
 */
@ApiTags('Search v2')
@Controller(['v2/search', 'search'])
@ApiTenantIdQuery()
@ApiLocaleQuery()
export class V2SearchController {
  constructor(
    private readonly v2SearchService: V2SearchService,
    private readonly usageMetrics: UsageMetricsService,
  ) {}

  @Get()
  @Version('2')
  @UseGuards(V2SearchEnabledGuard, ArcjetGuard)
  @ApiOperation({
    summary:
      'Search with intent, clarification questions and an emergency band (draft)',
    description:
      'Hybrid search plus classification and a rules engine. Behind the ' +
      '`V2_SEARCH_ENABLED` flag; the request and response shapes are a draft ' +
      'until the v2 ADR (ISS-2493).',
  })
  @ApiResponse({ status: 200, type: V2SearchResponseDto })
  @ApiHeader({ name: 'accept-language', schema: { default: 'en' } })
  @ApiHeader({
    name: 'x-tenant-id',
    required: true,
    description: X_TENANT_ID_HEADER_DESCRIPTION,
  })
  async getResources(
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: V2SearchQueryDto,
    @Req() req: Request,
  ): Promise<V2SearchResponseDto> {
    // Same usage counter as v1's SearchController.trackSearch: once per request.
    const context = {
      tenantId: req?.tenantId,
      acceptLanguage: req?.headers?.['accept-language'],
    };
    try {
      const response = await this.v2SearchService.search({ headers, query });
      this.usageMetrics.recordSearchRequest(
        context,
        'v2',
        searchOutcomeFromHits(response.search?.hits),
      );
      return response;
    } catch (error) {
      this.usageMetrics.recordSearchRequest(context, 'v2', 'error');
      throw error;
    }
  }
}
