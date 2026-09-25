import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Version,
} from '@nestjs/common';
import {
  ApiExcludeController,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import {
  RegionDetailDto,
  RegionIdParamDto,
  RegionSearchQueryDto,
  RegionSearchResponseDto,
} from './dto';
import { NotTenantScoped } from 'src/auth/gateway/gateway-principal';
import { InternalApiGuard } from 'src/common/guards/internal-api.guard';
import { RegionService } from './region.service';

/**
 * Region typeahead and lookup for ServiceNet's Geography filter (ADR 0024).
 * Internal and unpublished: left out of the OpenAPI document the Norse SDK is
 * generated from. Regions are not tenant data, so the routes are not
 * tenant-scoped; the internal key (`x-internal-api-key`) guards them on every
 * path — see docs/geography-filter.md.
 */
@ApiExcludeController()
@NotTenantScoped()
@UseGuards(InternalApiGuard)
@Controller('internal/regions')
export class RegionController {
  constructor(private readonly regionService: RegionService) {}

  @Get()
  @Version('1')
  @ApiOperation({
    summary: 'Regions (states, counties, ZIPs) matching typed text, ranked.',
  })
  @ApiResponse({ status: 200, type: RegionSearchResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 502, description: 'Elasticsearch request failed' })
  @ApiResponse({ status: 503, description: 'Elasticsearch timed out' })
  search(
    @Query() query: RegionSearchQueryDto,
  ): Promise<RegionSearchResponseDto> {
    return this.regionService.search(query);
  }

  @Get(':id')
  @Version('1')
  @ApiOperation({ summary: 'One Region with its boundary and attribution.' })
  @ApiResponse({ status: 200, type: RegionDetailDto })
  @ApiResponse({ status: 400, description: 'Malformed Region id' })
  @ApiResponse({ status: 404, description: 'No such Region' })
  @ApiResponse({ status: 502, description: 'Elasticsearch request failed' })
  @ApiResponse({ status: 503, description: 'Elasticsearch timed out' })
  get(@Param() params: RegionIdParamDto): Promise<RegionDetailDto> {
    return this.regionService.get(params.id);
  }
}
