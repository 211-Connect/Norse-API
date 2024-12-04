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
  getTaxonomies(
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
    @Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQueryDto,
  ) {
    return this.suggestionService.searchTaxonomies({
      headers,
      query,
    });
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
