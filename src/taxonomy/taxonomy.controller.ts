import {
  Controller,
  Get,
  Query,
  ValidationPipe,
  Version,
} from '@nestjs/common';
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
import { ApiTenantIdQuery, ApiLocaleQuery } from 'src/common/decorators';
import { TaxonomySearchQueryDto } from './dto/search-query.dto';
import { X_TENANT_ID_HEADER_DESCRIPTION } from 'src/common/swagger/header-descriptions';
import {
  TaxonomyTermsQueryDto,
  taxonomyTermsQuerySchema,
} from './dto/taxonomy-terms-query.dto';
import { TaxonomySearchResponse } from './dto/taxonomy-response.dto';
import { TaxonomyResponseDto } from './dto/taxonomy-response.dto';

@ApiTags('Taxonomy')
@Controller('taxonomy')
@ApiTenantIdQuery()
@ApiLocaleQuery()
export class TaxonomyController {
  constructor(private readonly taxonomyService: TaxonomyService) {}

  @Get()
  @Version('1')
  @ApiResponse({
    status: 200,
    description:
      'Returns simplified taxonomy data with only id, name, and code',
    type: TaxonomyResponseDto,
  })
  @ApiQuery({
    name: 'query',
    required: false,
    description: 'Search query for taxonomy name or code',
  })
  @ApiQuery({
    name: 'code',
    required: false,
    deprecated: true,
    description: 'Taxonomy code (deprecated, use query instead)',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    schema: { default: 1 },
    description: 'Page number for pagination',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    required: true,
    description: X_TENANT_ID_HEADER_DESCRIPTION,
  })
  @ApiHeader({
    name: 'accept-language',
    schema: {
      default: 'en',
    },
  })
  @ApiHeader({
    name: 'x-api-version',
    schema: {
      default: '1',
    },
  })
  getTaxonomies(
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: TaxonomySearchQueryDto,
  ): Promise<TaxonomyResponseDto> {
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
    description: X_TENANT_ID_HEADER_DESCRIPTION,
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
