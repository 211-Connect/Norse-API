import {
  Controller,
  Get,
  Post,
  HttpCode,
  Query,
  Body,
  Req,
  Version,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { SearchService } from './search.service';
import { MetricsService } from 'src/metrics/metrics.service';
import {
  ApiBody,
  ApiHeader,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ZodValidationPipe } from '../common/pipes/zod-validation-pipe';
import { SearchQueryDto, searchQuerySchema } from './dto/search-query.dto';
import { SearchResponseDto } from './dto/search-response.dto';
import { SearchBodyDto, searchBodySchema } from './dto/search-body.dto';
import { HeadersDto, headersSchema } from '../common/dto/headers.dto';
import { CustomHeaders } from '../common/decorators/CustomHeaders';
import { ApiQueryForComplexSearch } from './api-query-decorator';
import { HttpException, HttpStatus } from '@nestjs/common';
import { SearchResponse } from './dto/search-response.dto';
import { SetCdnCacheTTL } from 'src/common/decorators/cdn-cache-ttl.decorator';
import { ONE_HOUR } from 'src/common/const';
import { AiSearchReRankResponseDto } from './dto/ai-search-re-rank-response.dto';
import { AiSearchService } from './ai-search.service';
import { AiSearchReRankQueryDto } from './dto/ai-search-re-rank-query.dto';
import { AiSearchPredictResponseDto } from './dto/ai-search-predict-response.dto';
import { AiSearchPredictQueryDto } from './dto/ai-search-predict-query.dto';

@ApiTags('Search')
@Controller('search')
@ApiHeader({
  name: 'x-api-version',
  description: 'API version',
  required: true,
  schema: {
    default: '1',
  },
})
export class SearchController {
  constructor(
    private readonly searchService: SearchService,
    private readonly metricsService: MetricsService,
    private readonly aiSearchService: AiSearchService,
  ) {}

  @Get()
  @Version('1')
  @SetCdnCacheTTL(ONE_HOUR)
  @ApiResponse({
    status: 200,
    type: SearchResponseDto,
  })
  @ApiHeader({
    name: 'accept-language',
    schema: {
      default: 'en',
    },
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { minimum: 25, maximum: 300, default: 25, type: 'integer' },
  })
  @ApiQuery({
    name: 'distance',
    required: false,
    schema: { default: 0, type: 'integer', minimum: 0 },
  })
  @ApiQuery({ name: 'filters', required: false, schema: { type: 'object' } })
  @ApiQuery({
    name: 'coords',
    required: false,
    description: 'Comma delimited list of longitude,latitude',
    schema: {
      example: '-120.740135,47.751076',
    },
  })
  @ApiQuery({ name: 'page', required: false, schema: { default: 1 } })
  @ApiQuery({
    name: 'age',
    required: false,
    description: 'Searcher age used to match minimum_age/service.maximum_age',
    schema: { type: 'integer', minimum: 0 },
  })
  @ApiQuery({
    name: 'query_type',
    required: false,
    enum: ['text', 'taxonomy', 'more_like_this', 'hybrid'],
    schema: { default: 'text' },
  })
  @ApiQuery({
    name: 'taxonomy',
    required: false,
    description:
      'Comma-delimited HSIS taxonomy codes used as a hard scope for hybrid search (e.g. BM-1400,BM-1700)',
    schema: { type: 'string', example: 'BM-1400,BM-1700' },
  })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: ['relevance', 'distance', 'name', 'organization'],
    description:
      'Sort order: relevance (default), distance (requires coords), name (alphabetical by resource name), organization (alphabetical by provider name)',
    schema: { default: 'relevance' },
  })
  @ApiQueryForComplexSearch()
  getResources(
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
    @Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQueryDto,
  ): Promise<SearchResponse> {
    this.metricsService.incrementSearchHit(
      'GET',
      'getResources',
      headers['x-tenant-id'],
    );

    try {
      return this.searchService.searchResources({
        headers,
        query,
      });
    } catch (error) {
      // Attach minimal context and rethrow a controlled HTTP exception
      const message = error?.message ?? 'Search failed';
      const meta = { tenant: headers['x-tenant-id'], query };
      throw new HttpException(
        { message, meta },
        error?.status ?? HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post()
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({
    status: 200,
    description: 'Search resources (POST)',
    type: SearchResponseDto,
  })
  @ApiHeader({
    name: 'accept-language',
    schema: {
      default: 'en',
    },
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({
    name: 'Content-Type',
    required: true,
    description: 'application/json',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { minimum: 25, maximum: 300, default: 25, type: 'integer' },
  })
  @ApiQuery({
    name: 'distance',
    required: false,
    schema: { default: 0, type: 'integer', minimum: 0 },
  })
  @ApiQuery({ name: 'filters', required: false, schema: { type: 'object' } })
  @ApiQuery({
    name: 'coords',
    required: false,
    description: 'Comma delimited list of longitude,latitude',
    schema: {
      example: '-120.740135,47.751076',
    },
  })
  @ApiQuery({ name: 'page', required: false, schema: { default: 1 } })
  @ApiQuery({
    name: 'age',
    required: false,
    description: 'Searcher age used to match minimum_age/maximum_age',
    schema: { type: 'integer', minimum: 0 },
  })
  @ApiQuery({
    name: 'query_type',
    required: false,
    enum: ['text', 'taxonomy', 'more_like_this', 'hybrid'],
    schema: { default: 'text' },
  })
  @ApiQuery({
    name: 'taxonomy',
    required: false,
    description:
      'Comma-delimited HSIS taxonomy codes used as a hard scope for hybrid search (e.g. BM-1400,BM-1700)',
    schema: { type: 'string', example: 'BM-1400,BM-1700' },
  })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: ['relevance', 'distance', 'name', 'organization'],
    description:
      'Sort order: relevance (default), distance (requires coords), name (alphabetical by resource name), organization (alphabetical by provider name)',
    schema: { default: 'relevance' },
  })
  @ApiQueryForComplexSearch()
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        geometry: {
          type: 'object',
          description: 'GeoJSON geometry',
        },
      },
    },
  })
  getResourcesPost(
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
    @Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQueryDto,
    @Body(new ZodValidationPipe(searchBodySchema)) body: SearchBodyDto,
    @Req() req,
  ) {
    this.metricsService.incrementSearchHit(
      'POST',
      'getResourcesPost',
      headers['x-tenant-id'],
    );

    // Validate Content-Type
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('application/json')) {
      throw new BadRequestException('Content-Type must be application/json');
    }

    return this.searchService.searchResources({
      headers,
      query,
      body,
    });
  }

  @Get('predict')
  @Version('1')
  @SetCdnCacheTTL(ONE_HOUR)
  @ApiResponse({
    status: 200,
    description: 'Classify search intent and return UI guidance',
    type: AiSearchPredictResponseDto,
  })
  @ApiHeader({
    name: 'accept-language',
    schema: {
      default: 'en',
    },
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({ name: 'query', required: true, schema: { type: 'string' } })
  @ApiQuery({
    name: 'top_k',
    required: false,
    schema: { type: 'integer', minimum: 1, default: 150 },
  })
  predictNeedsClassification(
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: AiSearchPredictQueryDto,
  ): Promise<AiSearchPredictResponseDto> {
    this.metricsService.incrementSearchHit(
      'GET',
      'predictSearch',
      headers['x-tenant-id'],
    );

    return this.aiSearchService.predict(headers, query);
  }

  @Get('re-rank')
  @Version('1')
  @SetCdnCacheTTL(ONE_HOUR)
  @ApiResponse({
    status: 200,
    description: 'Re-rank taxonomy hits after user-adjusted needs selection',
    type: AiSearchReRankResponseDto,
  })
  @ApiHeader({
    name: 'accept-language',
    schema: {
      default: 'en',
    },
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({
    name: 'need_weights',
    required: true,
    description:
      'JSON string map of need weights (URL-encoded), e.g. {"HO-300":0.9,"IC-330":0.08}',
    schema: { type: 'string' },
  })
  @ApiQuery({
    name: 'top_k',
    required: false,
    schema: { type: 'integer', minimum: 1, default: 150 },
  })
  reRankNeedsClassification(
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: AiSearchReRankQueryDto,
  ): Promise<AiSearchReRankResponseDto> {
    this.metricsService.incrementSearchHit(
      'GET',
      'reRankSearch',
      headers['x-tenant-id'],
    );

    return this.aiSearchService.reRank(headers, {
      need_weights: this.parseNeedWeightsQuery(query.need_weights),
      top_k: query.top_k,
    });
  }

  private parseNeedWeightsQuery(
    rawNeedWeights: string,
  ): Record<string, number> {
    let parsed: unknown;

    try {
      parsed = JSON.parse(rawNeedWeights);
    } catch {
      throw new BadRequestException(
        'need_weights must be a valid JSON object string',
      );
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestException(
        'need_weights must be a JSON object with number values',
      );
    }

    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.length === 0) {
      throw new BadRequestException('need_weights must not be empty');
    }

    const result: Record<string, number> = {};
    for (const [key, value] of entries) {
      if (typeof key !== 'string' || key.trim().length === 0) {
        throw new BadRequestException(
          'need_weights keys must be non-empty strings',
        );
      }

      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new BadRequestException(
          'need_weights values must be finite numbers',
        );
      }

      result[key] = value;
    }

    return result;
  }
}
