import { Controller, Get, Query, Version } from '@nestjs/common';
import { ApiHeader, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CustomHeaders } from 'src/common/decorators/CustomHeaders';
import { Tenant } from 'src/common/decorators/Tenant';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation-pipe';
import { HeadersDto, headersSchema } from 'src/common/dto/headers.dto';
import { Request } from 'express';
import { SemanticTaxonomySuggestionService } from './semantic_taxonomy_suggestion.service';
import {
  TaxonomySuggestionQueryDto,
  taxonomySuggestionQuerySchema,
} from './dto/taxonomy-suggestion-query.dto';
import { TaxonomySuggestionResponse } from './dto/taxonomy-suggestion-response.dto';

@ApiTags('Semantic Taxonomy Suggestion')
@Controller('semantic-taxonomy-suggestion')
export class SemanticTaxonomySuggestionController {
  constructor(
    private readonly suggestionService: SemanticTaxonomySuggestionService,
  ) {}

  /**
   * Get taxonomy suggestions based on intent classification and text search
   *
   * This endpoint provides real-time taxonomy suggestions as users type their query.
   * It combines:
   * 1. Intent classification to predict relevant taxonomy codes
   * 2. Traditional text matching on taxonomy codes and names as fallback
   *
   * The results are aggregated across all resources and ranked by relevance.
   */
  @Get()
  @Version('1')
  @ApiResponse({
    status: 200,
    description: 'Returns taxonomy suggestions based on the query',
  })
  @ApiQuery({
    name: 'query',
    required: true,
    description: 'User search query (will be classified for intent prediction)',
    example: 'food assistance',
  })
  @ApiQuery({
    name: 'code',
    required: false,
    description:
      'Optional taxonomy code prefix(es) to filter results. Supports hierarchical filtering. ' +
      'Can be a single code (e.g., "BD") or multiple codes (e.g., "code=B&code=L"). ' +
      'Only taxonomies starting with the specified prefix(es) will be returned.',
    example: 'BD',
    isArray: true,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of suggestions to return (default: 10, max: 50)',
    schema: { default: 10 },
  })
  @ApiQuery({
    name: 'lang',
    required: false,
    description: 'Language/locale for the search',
    schema: { default: 'en' },
  })
  @ApiHeader({
    name: 'x-tenant-id',
    required: true,
    description: 'Tenant identifier',
  })
  @ApiHeader({
    name: 'accept-language',
    required: false,
    description: 'Language preference (overridden by lang query param)',
    schema: { default: 'en' },
  })
  async getTaxonomySuggestions(
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
    @Query(new ZodValidationPipe(taxonomySuggestionQuerySchema))
    query: TaxonomySuggestionQueryDto,
    @Tenant() tenant: Request['tenant'],
  ): Promise<TaxonomySuggestionResponse> {
    return this.suggestionService.getTaxonomySuggestions(
      query,
      headers,
      tenant,
    );
  }

  /**
   * Health check endpoint for the semantic taxonomy suggestion service
   */
  @Get('health')
  @Version('1')
  @ApiResponse({
    status: 200,
    description: 'Returns health status of the service',
  })
  async checkHealth() {
    return this.suggestionService.checkHealth();
  }
}
