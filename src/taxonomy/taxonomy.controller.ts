import { Controller, Get, Query, Version } from '@nestjs/common';
import { TaxonomyService } from './taxonomy.service';
import {
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CustomHeaders } from 'src/common/decorators/CustomHeaders';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation-pipe';
import { HeadersDto, headersSchema } from 'src/common/dto/headers.dto';
import { SearchQueryDto, searchQuerySchema } from './dto/search-query.dto';
import {
  TaxonomyTermsQueryDto,
  taxonomyTermsQuerySchema,
} from './dto/taxonomy-terms-query.dto';
import { TaxonomySearchResponse } from './dto/taxonomy-response.dto';

@ApiTags('Taxonomy')
@Controller('taxonomy')
export class TaxonomyController {
  constructor(private readonly taxonomyService: TaxonomyService) {}

  @Get()
  @Version('1')
  @ApiOperation({
    summary: 'Search taxonomies',
    description:
      'Search for taxonomies by name or code using prefix matching. Supports pagination.',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved taxonomy search results',
    schema: {
      type: 'object',
      properties: {
        hits: {
          type: 'object',
          properties: {
            total: {
              oneOf: [
                { type: 'number' },
                {
                  type: 'object',
                  properties: {
                    value: { type: 'number' },
                    relation: { type: 'string', example: 'eq' },
                  },
                },
              ],
            },
            max_score: { type: 'number', nullable: true },
            hits: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  _index: { type: 'string' },
                  _id: { type: 'string' },
                  _score: { type: 'number' },
                  _source: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: 'Taxonomy name' },
                      description: {
                        type: 'string',
                        description: 'Taxonomy description',
                      },
                      id: { type: 'string', description: 'Taxonomy ID' },
                      taxonomy: {
                        type: 'string',
                        description: 'Taxonomy classification',
                      },
                      tenant_id: {
                        type: 'string',
                        description: 'Tenant identifier',
                      },
                      code: { type: 'string', description: 'Taxonomy code' },
                      type: { type: 'string', description: 'Taxonomy type' },
                      created_at: {
                        type: 'string',
                        format: 'date-time',
                        description: 'Creation timestamp',
                      },
                      updated_at: {
                        type: 'string',
                        format: 'date-time',
                        description: 'Last update timestamp',
                      },
                    },
                  },
                },
              },
            },
          },
        },
        took: { type: 'number', description: 'Query execution time in ms' },
        timed_out: { type: 'boolean', description: 'Whether query timed out' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - query or code parameter is required',
  })
  @ApiQuery({
    name: 'query',
    required: false,
    description:
      'Search query for taxonomy name or code. Uses prefix matching.',
    example: 'NAICS',
  })
  @ApiQuery({
    name: 'code',
    required: false,
    deprecated: true,
    description: 'Deprecated: Use query parameter instead',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    schema: { default: 1 },
    description: 'Page number for pagination (10 results per page)',
    example: 1,
  })
  @ApiHeader({
    name: 'x-tenant-id',
    required: true,
    description: 'Tenant identifier',
  })
  @ApiHeader({
    name: 'accept-language',
    required: false,
    schema: { default: 'en' },
    description: 'Language preference for results',
  })
  getTaxonomies(
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
    @Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQueryDto,
  ): Promise<TaxonomySearchResponse> {
    return this.taxonomyService.searchTaxonomies({
      headers,
      query,
    });
  }

  @Get('term')
  @Version('1')
  @ApiOperation({
    summary: 'Get taxonomy terms by codes',
    description:
      'Retrieve specific taxonomy terms by their exact codes. Accepts single code or array of codes.',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved taxonomy terms',
  })
  @ApiQuery({
    name: 'terms',
    required: false,
    description:
      'Taxonomy code(s) to look up. Can be a single code or comma-separated codes.',
    example: 'NAICS-11',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    required: true,
    description: 'Tenant identifier',
  })
  @ApiHeader({
    name: 'accept-language',
    required: false,
    schema: { default: 'en' },
    description: 'Language preference for results',
  })
  getTaxonomyTermsByCode(
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
    @Query(new ZodValidationPipe(taxonomyTermsQuerySchema))
    query: TaxonomyTermsQueryDto,
  ): Promise<TaxonomySearchResponse> {
    return this.taxonomyService.getTaxonomyTermsForCodes({
      headers,
      query,
    });
  }
}
