import { Controller, Get, Param, Query, Version } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiTenantIdQuery } from 'src/common/decorators';
import { X_TENANT_ID_HEADER_DESCRIPTION } from 'src/common/swagger/header-descriptions';
import { V1_AND_LEGACY } from '../../common/versioning/api-version';
import {
  RegionDetailDto,
  RegionIdParamDto,
  RegionService,
  StateRegionsQueryDto,
  StateRegionsResponseDto,
} from '../internal';

/**
 * One Region with its boundary, for drawing the searched area on a map — see
 * docs/area-search.md. Regions are not tenant data, but like every public
 * Norse API route this one is called on behalf of a tenant.
 */
@ApiTags('Region')
@Controller('regions')
@ApiTenantIdQuery()
@ApiHeader({
  name: 'x-api-version',
  description: 'API version',
  required: true,
  schema: { default: '1' },
})
export class RegionPublicController {
  constructor(private readonly regionService: RegionService) {}

  @Get()
  @Version(V1_AND_LEGACY)
  @ApiHeader({
    name: 'x-tenant-id',
    required: true,
    description: X_TENANT_ID_HEADER_DESCRIPTION,
  })
  @ApiOperation({
    summary: "A state's counties and places, without boundaries.",
    description:
      'For choosing which Regions get SEO landing pages. Sorted by name. ' +
      'Each place carries `county_id`, the county containing its centroid. ' +
      'Global catalog: not filtered by tenant coverage.',
  })
  @ApiResponse({ status: 200, type: StateRegionsResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid state or types' })
  @ApiResponse({ status: 502, description: 'Elasticsearch request failed' })
  @ApiResponse({ status: 503, description: 'Elasticsearch timed out' })
  listByState(
    @Query() query: StateRegionsQueryDto,
  ): Promise<StateRegionsResponseDto> {
    return this.regionService.listByState(query);
  }

  @Get(':id')
  @Version(V1_AND_LEGACY)
  @ApiHeader({
    name: 'x-tenant-id',
    required: true,
    description: X_TENANT_ID_HEADER_DESCRIPTION,
  })
  @ApiOperation({
    summary: 'One Region (state, county, place or ZIP) with its boundary.',
    description:
      'The id is what `GET /search` takes as `region` and returns in ' +
      '`resolved_location`, e.g. `county:53077`.',
  })
  @ApiResponse({ status: 200, type: RegionDetailDto })
  @ApiResponse({ status: 400, description: 'Malformed Region id' })
  @ApiResponse({ status: 404, description: 'No such Region' })
  @ApiResponse({ status: 502, description: 'Elasticsearch request failed' })
  @ApiResponse({ status: 503, description: 'Elasticsearch timed out' })
  get(@Param() params: RegionIdParamDto): Promise<RegionDetailDto> {
    return this.regionService.get(params.id);
  }
}
