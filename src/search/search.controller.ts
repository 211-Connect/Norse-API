import { Controller, Get, Post, Query, Body, Req, Version, BadRequestException } from '@nestjs/common';
import { SearchService } from './search.service';
import { ApiHeader, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../common/pipes/zod-validation-pipe';
import { SearchQueryDto, searchQuerySchema } from './dto/search-query.dto';
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
    example: {
      search: {
        took: 5,
        timed_out: false,
        _shards: {
          total: 1,
          successful: 1,
          skipped: 0,
          failed: 0,
        },
        hits: {
          total: {
            value: 227,
            relation: 'eq',
          },
          max_score: null,
          hits: [
            {
              _index: 'results_v2_en',
              _id: '00000000-0000-0000-0000-000000000000',
              _score: null,
              _routing: '00000000-0000-0000-0000-000000000000',
              _source: {
                id: '00000000-0000-0000-0000-000000000000',
                service_at_location_id: '00000000-0000-0000-0000-000000000000',
                service_id: '00000000-0000-0000-0000-000000000000',
                location_id: '00000000-0000-0000-0000-000000000000',
                organization_id: '00000000-0000-0000-0000-000000000000',
                primary_email: 'info@example.com',
                primary_phone: '(555) 555-555',
                primary_website: 'https://www.example.com',
                email: 'info@example.org',
                phone: '(555) 555-5555',
                website: 'https://www.example.com',
                display_email: 'info@example.com',
                display_phone_number: '(555) 555-5555',
                display_website: 'https://www.example.com',
                organization_name: 'EXAMPLE ORGANIZATION',
                organization_alternate_name: null,
                organization_description:
                  'The example organization can help families and victims of disaster with immediate disaster caused needs including food, shelter and other needs. The example organization helps facilitate emergency messages for the Armed Forces. The example organization also provides CPR/AED and First Aid training to the community.',
                organization_short_description: null,
                location_latitude: null,
                location_longitude: null,
                service_name: 'MILITARY AND VETERAN CAREGIVER NETWORK',
                service_alternate_name: null,
                location_name: 'EXAMPLE LOCATION',
                location_alternate_name: null,
                location_description: null,
                location_short_description: null,
                display_name:
                  'MILITARY AND VETERAN CAREGIVER NETWORK | EXAMPLE ORGANIZATION',
                display_alternate_name: null,
                display_description:
                  'The Military and Veteran Caregiver Network (MVCN) offers peer-based support and services to connect those providing care to service members and veterans living with wounds, illnesses, injuries and/or aging.',
                display_short_description: null,
                service_description:
                  'The Military and Veteran Caregiver Network (MVCN) offers peer-based support and services to connect those providing care to service members and veterans living with wounds, illnesses, injuries and/or aging.',
                service_short_description: null,
                address_1: 'Multiple Locations',
                city: null,
                state: null,
                postal_code: null,
                physical_address: 'Multiple Locations',
                physical_address_1: 'Multiple Locations',
                physical_address_2: null,
                physical_address_city: null,
                physical_address_state: null,
                physical_address_postal_code: null,
                physical_address_country: 'United States',
                taxonomy_terms: ['Caregiver Consultation and Support'],
                taxonomy_descriptions: [],
                taxonomy_codes: ['NW-0000'],
                location: {
                  type: 'Point',
                  coordinates: [0, 0],
                },
                location_coordinates: {
                  type: 'Point',
                  coordinates: [0, 0],
                },
                source_service_area: null,
                tenant_id: '00000000-0000-0000-0000-000000000000',
                days_open: null,
                service_provided: null,
                need_within: null,
                facets: {
                  area_served_by_county: {
                    en: ['Dakota County', 'Hennepin County'],
                  },
                },
                created_at: null,
                updated_at: null,
                priority: 0,
              },
              sort: [0],
            },
          ],
        },
      },
      facets: {
        area_served_by_county: {
          en: ['Dakota County', 'Hennepin County'],
        },
      },
    },
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
    // Reuse the same example/schema as GET if possible, or duplicate the ApiResponse from GET
  })
  @ApiHeader({
    name: 'accept-language',
    schema: {
      default: 'en',
    },
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({ name: 'Content-Type', required: true, description: 'application/json' })
  @ApiQueryForComplexSearch()
  getResourcesPost(
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
    @Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQueryDto,
    @Body(new ZodValidationPipe(searchBodySchema)) body: SearchBodyDto,
    @Req() req,
  ) {
    // Validate Content-Type
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('application/json')) {
      throw new BadRequestException(
        'Content-Type must be application/json',
      );
    }

    return this.searchService.searchResources({
      headers,
      query,
      body,
      tenant: req.tenant,
    });
  }
}
