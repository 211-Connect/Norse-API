import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Req,
  Version,
  BadRequestException,
} from '@nestjs/common';
import { SearchService } from './search.service';
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
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @Version('1')
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
    name: 'query_type',
    required: false,
    enum: ['text', 'taxonomy', 'more_like_this'],
    schema: { default: 'text' },
  })
  @ApiQueryForComplexSearch()
  getResources(
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
    @Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQueryDto,
    @Req() req,
  ): Promise<SearchResponse> {
    try {
      return this.searchService.searchResources({
        headers,
        query,
        tenant: req.tenant,
      });
    } catch (error) {
      // Attach minimal context and rethrow a controlled HTTP exception
      const message = error?.message ?? 'Search failed';
      const meta = { tenant: req.tenant?.id, query };
      throw new HttpException(
        { message, meta },
        error?.status ?? HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post()
  @Version('1')
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
    name: 'query_type',
    required: false,
    enum: ['text', 'taxonomy', 'more_like_this'],
    schema: { default: 'text' },
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
    // Validate Content-Type
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('application/json')) {
      throw new BadRequestException('Content-Type must be application/json');
    }

    return this.searchService.searchResources({
      headers,
      query,
      body,
      tenant: req.tenant,
    });
  }
}
