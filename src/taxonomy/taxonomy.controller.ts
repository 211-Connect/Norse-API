import { Controller, Get, Query } from '@nestjs/common';
import { TaxonomyService } from './taxonomy.service';
import { ApiHeader, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { CustomHeaders } from 'src/common/decorators/CustomHeaders';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation-pipe';
import { HeadersDto, headersSchema } from 'src/common/dto/headers.dto';
import { SearchQueryDto, searchQuerySchema } from './dto/search-query.dto';

@Controller('taxonomy')
export class TaxonomyController {
  constructor(private readonly taxonomyService: TaxonomyService) {}

  @Get()
  @ApiResponse({
    status: 200,
  })
  @ApiQuery({ name: 'query', required: false })
  @ApiQuery({ name: 'code', required: false })
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
    return this.taxonomyService.searchTaxonomies({
      headers,
      query,
    });
  }
}