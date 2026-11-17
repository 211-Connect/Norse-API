import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
  Version,
} from '@nestjs/common';
import {
  ApiBody,
  ApiExcludeController,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { CustomHeaders } from '../../common/decorators/CustomHeaders';
import { ApiLocaleQuery, ApiTenantIdQuery } from '../../common/decorators';
import { HeadersDto } from '../../common/dto/headers.dto';
import { ArcjetGuard } from '../../common/guards/arcjet.guard';
import { X_TENANT_ID_HEADER_DESCRIPTION } from '../../common/swagger/header-descriptions';
import {
  UsageMetricsService,
  searchOutcomeFromHits,
} from '../../metrics/usage-metrics.service';
import { SearchResourcesBodyDto } from '../../search/dto/search-body.dto';
import { V2SearchQueryDto } from './dto/v2-search-query.dto';
import { V2ErrorDto, V2SearchResponseDto } from './dto/v2-search-response.dto';
import { V2HeadersPipe } from './v2-headers.pipe';
import { V2SearchEnabledGuard } from './v2-search-enabled.guard';
import { V2SearchService } from './v2-search.service';

const OK_DESCRIPTION =
  'The search answer. A failed classification still answers 200 (`model_version` is null, the emergency question can appear). A failed embedding still answers 200 with keyword results only.';
const BAD_REQUEST =
  'A header or a query value failed validation, for example a missing or malformed `x-tenant-id`, an `accept-language` that is not exactly one supported code, `limit` under 25, an unknown need code, an unknown `urgency`, or (POST) a Content-Type other than application/json.';
const NOT_FOUND =
  'The `V2_SEARCH_ENABLED` flag is not `true`: the route looks absent.';

/**
 * Reached by `GET /v2/search` (the `/v2/` path selects version 2) and by
 * `GET /search` with `x-api-version: 2`. No CDN cache decorator: the rules
 * engine's `decision.cacheable` (internal emergency band none and no emergency
 * question, ADR 0039 Decision 28) is the cache rule, but no `Cache-Control`
 * header is written from it yet (exact numbers: ADR 0039 Question 11).
 *
 * Kept out of the Swagger document while the shapes are a draft: the document
 * generates the frontend SDK, and a draft must not reach it. Remove
 * `@ApiExcludeController()` when the v2 ADR (ISS-2493) is accepted.
 */
@ApiExcludeController()
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
      'Search with intent and clarification questions, the emergency question first (draft)',
    description:
      'Hybrid search plus classification and a rules engine. Behind the ' +
      '`V2_SEARCH_ENABLED` flag; the request and response shapes are a draft ' +
      'until the v2 ADR (ISS-2493).',
  })
  @ApiResponse({
    status: 200,
    type: V2SearchResponseDto,
    description: OK_DESCRIPTION,
  })
  @ApiHeader({
    name: 'accept-language',
    required: true,
    description:
      'Exactly one supported language code, for example `en` or `es`. It picks the search index. A region tag (`en-US`) or a weighted list is a 400.',
    schema: { type: 'string', default: 'en' },
  })
  @ApiHeader({
    name: 'x-api-version',
    required: false,
    description:
      'Only on `/search`: send `2` to reach this route. `/v2/search` needs no version header.',
    schema: { type: 'string', enum: ['2'] },
  })
  @ApiResponse({ status: 400, type: V2ErrorDto, description: BAD_REQUEST })
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiHeader({
    name: 'x-tenant-id',
    required: true,
    description: X_TENANT_ID_HEADER_DESCRIPTION,
    schema: { type: 'string', format: 'uuid' },
  })
  async getResources(
    @CustomHeaders(new V2HeadersPipe()) headers: HeadersDto,
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: V2SearchQueryDto,
    @Req() req: Request,
  ): Promise<V2SearchResponseDto> {
    return this.trackSearch(req, () =>
      this.v2SearchService.search({
        headers,
        query,
      }),
    );
  }

  @Post()
  @Version('2')
  @UseGuards(V2SearchEnabledGuard, ArcjetGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Search with a GeoJSON geometry body (draft)',
    description:
      'Same as `GET`, with the v1 POST body (`geometry`). Behind the ' +
      '`V2_SEARCH_ENABLED` flag; the shapes are a draft until the v2 ADR ' +
      '(ISS-2493).',
  })
  @ApiResponse({
    status: 200,
    type: V2SearchResponseDto,
    description: OK_DESCRIPTION,
  })
  @ApiHeader({
    name: 'accept-language',
    required: true,
    description:
      'Exactly one supported language code, for example `en` or `es`. It picks the search index. A region tag (`en-US`) or a weighted list is a 400.',
    schema: { type: 'string', default: 'en' },
  })
  @ApiHeader({
    name: 'x-api-version',
    required: false,
    description:
      'Only on `/search`: send `2` to reach this route. `/v2/search` needs no version header.',
    schema: { type: 'string', enum: ['2'] },
  })
  @ApiResponse({ status: 400, type: V2ErrorDto, description: BAD_REQUEST })
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiHeader({
    name: 'x-tenant-id',
    required: true,
    description: X_TENANT_ID_HEADER_DESCRIPTION,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        geometry: { type: 'object', description: 'GeoJSON geometry' },
      },
    },
  })
  async getResourcesPost(
    @CustomHeaders(new V2HeadersPipe()) headers: HeadersDto,
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: V2SearchQueryDto,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: SearchResourcesBodyDto,
    @Req() req: Request,
  ): Promise<V2SearchResponseDto> {
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('application/json')) {
      throw new BadRequestException('Content-Type must be application/json');
    }
    return this.trackSearch(req, () =>
      this.v2SearchService.search({
        headers,
        query,
        body,
      }),
    );
  }

  // Same usage counter as v1's SearchController.trackSearch: once per request.
  private async trackSearch(
    req: Request,
    run: () => Promise<V2SearchResponseDto>,
  ): Promise<V2SearchResponseDto> {
    const context = {
      tenantId: req?.tenantId,
      acceptLanguage: req?.headers?.['accept-language'],
    };
    try {
      const response = await run();
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
