import {
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
  Version,
} from '@nestjs/common';
import {
  ApiBody,
  ApiExcludeController,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import {
  ServicesFacetsRequestDto,
  ServicesFacetsResponseDto,
  ServicesSearchRequestDto,
  ServicesSearchResponseDto,
} from './dto';
import { NotTenantScoped } from 'src/auth/gateway/gateway-principal';
import { InternalApiGuard } from 'src/common/guards/internal-api.guard';
import { ServiceSearchService } from './service-search.service';

/**
 * ServiceNet's record selector reads services through these routes (ADR 0023).
 * Internal and unpublished: left out of the OpenAPI document the Norse SDK is
 * generated from. They trust the writer set they are given, so they are not
 * tenant-scoped; the internal key (`x-internal-api-key`) guards them on every
 * path — see docs/geography-filter.md.
 */
@ApiExcludeController()
@NotTenantScoped()
@UseGuards(InternalApiGuard)
@Controller('internal/services')
export class ServiceSearchController {
  constructor(private readonly searchService: ServiceSearchService) {}

  @Post('search')
  @Version('1')
  @HttpCode(200)
  @ApiOperation({
    summary:
      "One page of a writer set's canonical services with the total: by relevance then serviceId when text is given, else by name then serviceId.",
  })
  @ApiBody({ type: ServicesSearchRequestDto })
  @ApiResponse({ status: 200, type: ServicesSearchResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 502, description: 'Elasticsearch request failed' })
  @ApiResponse({ status: 503, description: 'Elasticsearch timed out' })
  search(
    @Body() body: ServicesSearchRequestDto,
  ): Promise<ServicesSearchResponseDto> {
    return this.searchService.search(body);
  }

  @Post('facets')
  @Version('1')
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Contributor, status and taxonomy counts over a writer set's canonical services.",
  })
  @ApiBody({ type: ServicesFacetsRequestDto })
  @ApiResponse({ status: 200, type: ServicesFacetsResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 502, description: 'Elasticsearch request failed' })
  @ApiResponse({ status: 503, description: 'Elasticsearch timed out' })
  facets(
    @Body() body: ServicesFacetsRequestDto,
  ): Promise<ServicesFacetsResponseDto> {
    return this.searchService.facets(body);
  }
}
