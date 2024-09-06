import { Controller, Get, Query, Req } from '@nestjs/common';
import { SearchService } from './search.service';
import { ApiHeader, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../common/pipes/zod-validation-pipe';
import { SearchQueryDto, searchQuerySchema } from './dto/search-query.dto';
import { HeadersDto, headersSchema } from '../common/dto/headers.dto';
import { CustomHeaders } from 'src/common/decorators/CustomHeaders';

@ApiTags('Search')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiResponse({
    status: 200,
  })
  @ApiQuery({ name: 'query', required: false })
  @ApiQuery({
    name: 'query_type',
    required: false,
    enum: ['text', 'taxonomy', 'more_like_this'],
    schema: { default: 'text' },
  })
  @ApiQuery({ name: 'page', required: false, schema: { default: 1 } })
  @ApiQuery({
    name: 'coords',
    required: false,
    description: 'Comma delimited list of longitude,latitude',
    schema: {
      example: '-120.740135,47.751076',
    },
  })
  @ApiQuery({ name: 'filters', required: false, schema: { type: 'object' } })
  @ApiQuery({
    name: 'distance',
    required: false,
    schema: { default: 0, type: 'integer', minimum: 0 },
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { minimum: 25, maximum: 300, default: 25, type: 'integer' },
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({
    name: 'accept-language',
    schema: {
      default: 'en',
    },
  })
  getResources(
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
    @Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQueryDto,
    @Req() req,
  ) {
    return this.searchService.searchResources({
      headers,
      query,
      tenant: req.tenant,
    });
  }
}
