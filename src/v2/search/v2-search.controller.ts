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
  ApiQuery,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { CustomHeaders } from '../../common/decorators/CustomHeaders';
import {
  RequireCdnUrlMirrors,
  SetCdnCacheTTL,
} from '../../common/decorators/cdn-cache-ttl.decorator';
import { ONE_HOUR } from '../../common/const/one-hour';
import { ApiLocaleQuery, ApiTenantIdQuery } from '../../common/decorators';
import { HeadersDto } from '../../common/dto/headers.dto';
import { ArcjetGuard } from '../../common/guards/arcjet.guard';
import {
  UsageMetricsService,
  searchOutcomeFromHits,
} from '../../metrics/usage-metrics.service';
import { SearchResourcesBodyDto } from '../../search/dto/search-body.dto';
import { V2SearchQueryDto } from './dto/v2-search-query.dto';
import { V2SearchResponseDto } from './dto/v2-search-response.dto';
import { V2HeadersPipe } from './v2-headers.pipe';
import { V2SearchEnabledGuard } from './v2-search-enabled.guard';
import { V2UrlMirrorsGuard } from './v2-url-mirrors.guard';
import { V2SearchService } from './v2-search.service';

/**
 * Reached by `GET /v2/search` (the `/v2/` path selects version 2) and by
 * `GET /search` with `x-api-version: 2` (ADR 0039 Decision 9).
 *
 * Cache (Decisions 28 and 59): `GET` declares `V2_SEARCH_CDN_TTL`, and the
 * shared `CdnCacheControlInterceptor` writes the header. The service marks an
 * answer with an emergency question, or a failed check, as not storable
 * (`markNotStorable`), so it gets `no-store`. On `/search` the header picked
 * v2, so the interceptor never lets a shared cache store it there. The body
 * depends on `x-tenant-id` and `accept-language`, and a URL-keyed CDN ignores
 * `Vary`: so every request needs the `tenant_id` and `locale` URL copies
 * (`V2UrlMirrorsGuard`, 400 when missing; the middleware 400s a mismatch).
 * `@RequireCdnUrlMirrors()` stays as a second line: no-store without them.
 *
 * Kept out of the Swagger document while the shapes are a draft: the document
 * generates the frontend SDK, and a draft must not reach it. Remove
 * `@ApiExcludeController()` when the v2 ADR (ISS-2493) is accepted.
 */
/** ADR 0039 Question 11 leaves the number open; the same hour as v1 /search. */
export const V2_SEARCH_CDN_TTL = ONE_HOUR;

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
  @UseGuards(V2SearchEnabledGuard, V2UrlMirrorsGuard, ArcjetGuard)
  @SetCdnCacheTTL(V2_SEARCH_CDN_TTL)
  @RequireCdnUrlMirrors()
  @ApiOperation({
    summary:
      'Search with intent and clarification questions, the emergency question first (draft)',
    description:
      'Hybrid search plus classification and a rules engine. Behind the ' +
      '`V2_SEARCH_ENABLED` flag; the request and response shapes are a draft ' +
      'until the v2 ADR (ISS-2493).',
  })
  @ApiResponse({ status: 200, type: V2SearchResponseDto })
  @ApiQuery({
    name: 'tenant_id',
    required: true,
    description:
      'Tenant UUID. v2 reads it from the URL only; the x-tenant-id header is not read (ADR 0039 Decision 34).',
  })
  @ApiQuery({
    name: 'locale',
    required: true,
    schema: { default: 'en' },
    description:
      'One supported language code. v2 reads it from the URL only; the accept-language header is not read.',
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
  @UseGuards(V2SearchEnabledGuard, V2UrlMirrorsGuard, ArcjetGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Search with a GeoJSON geometry body (draft)',
    description:
      'Same as `GET`, with the v1 POST body (`geometry`). Behind the ' +
      '`V2_SEARCH_ENABLED` flag; the shapes are a draft until the v2 ADR ' +
      '(ISS-2493).',
  })
  @ApiResponse({ status: 200, type: V2SearchResponseDto })
  @ApiQuery({
    name: 'tenant_id',
    required: true,
    description:
      'Tenant UUID. v2 reads it from the URL only; the x-tenant-id header is not read (ADR 0039 Decision 34).',
  })
  @ApiQuery({
    name: 'locale',
    required: true,
    schema: { default: 'en' },
    description:
      'One supported language code. v2 reads it from the URL only; the accept-language header is not read.',
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
