import { Controller, Get, Query, Version } from '@nestjs/common';
import { ApiHeader, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CustomHeaders } from 'src/common/decorators/CustomHeaders';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation-pipe';
import { HeadersDto, headersSchema } from 'src/common/dto/headers.dto';
import { SearchQueryDto, searchQuerySchema } from './dto/search-query.dto';
import {
  TaxonomyTermsQueryDto,
  taxonomyTermsQuerySchema,
} from './dto/taxonomy-terms-query.dto';
import { SuggestionService } from './suggestion.service';

@ApiTags('Suggestion')
@Controller('suggestion')
export class SuggestionController {
  constructor(private readonly suggestionService: SuggestionService) {}

  @Get()
  @Version('1')
  @ApiResponse({
    status: 200,
    description: 'V1: Original suggestion logic without stemming',
  })
  @ApiQuery({ name: 'query', required: false })
  @ApiQuery({ name: 'code', required: false, deprecated: true })
  @ApiQuery({ name: 'page', required: false, schema: { default: 1 } })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({
    name: 'accept-language',
    schema: {
      default: 'en',
    },
  })
  getTaxonomiesV1(
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
    @Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQueryDto,
  ) {
    return this.suggestionService.searchTaxonomies(
      {
        headers,
        query,
      },
      '1',
    );
  }

  @Get()
  @Version('2')
  @ApiResponse({
    status: 200,
    description:
      'V2: Enhanced suggestion logic with POS tagging and stemming for improved relevance',
  })
  @ApiQuery({ name: 'query', required: false })
  @ApiQuery({ name: 'code', required: false, deprecated: true })
  @ApiQuery({ name: 'page', required: false, schema: { default: 1 } })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({
    name: 'accept-language',
    schema: {
      default: 'en',
    },
  })
  getTaxonomiesV2(
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
    @Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQueryDto,
  ) {
    return this.suggestionService.searchTaxonomies(
      {
        headers,
        query,
      },
      '2',
    );
  }

  @Get()
  @Version('3')
  @ApiResponse({
    status: 200,
    description:
      'V3: Intent-enhanced suggestion with dual-query search (user nouns + intent nouns)',
  })
  @ApiQuery({ name: 'query', required: false })
  @ApiQuery({ name: 'code', required: false, deprecated: true })
  @ApiQuery({ name: 'page', required: false, schema: { default: 1 } })
  @ApiQuery({
    name: 'disable_intent_classification',
    required: false,
    schema: { default: false },
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiHeader({
    name: 'accept-language',
    schema: {
      default: 'en',
    },
  })
  getTaxonomiesV3(
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
    @Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQueryDto,
  ) {
    return this.suggestionService.searchTaxonomies(
      {
        headers,
        query,
      },
      '3',
    );
  }

  @Get('term')
  @Version('1')
  getTaxonomyTermsByCode(
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
    @Query(new ZodValidationPipe(taxonomyTermsQuerySchema))
    query: TaxonomyTermsQueryDto,
  ) {
    return this.suggestionService.getTaxonomyTermsForCodes({
      headers,
      query,
    });
  }
}
