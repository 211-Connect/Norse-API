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
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
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
import {
  PlaceDetailDto,
  PlaceListDto,
  PlaceListQueryDto,
  PlaceSlugParamDto,
} from './dto/place.dto';
import { V1_AND_LEGACY } from '../../common/versioning/api-version';

/**
 * Region typeahead and lookup for ServiceNet's Geography filter (ADR 0024).
 * Internal and unpublished: left out of the OpenAPI document the Norse SDK is
 * generated from. Regions are not tenant data, so the routes are not
 * tenant-scoped; the internal key (`x-internal-api-key`) guards them on every
 * path — see docs/geography-filter.md.
 */
@ApiSecurity('x-internal-api-key')
@ApiHeader({
  name: 'x-api-version',
  required: false,
  description: 'API version; defaults to 1 when omitted.',
  schema: { type: 'string', enum: ['1'], default: '1' },
})
@NotTenantScoped()
@UseGuards(InternalApiGuard)
@Controller('internal/regions')
export class RegionController {
  constructor(private readonly regionService: RegionService) {}

  @Get()
  @Version(V1_AND_LEGACY)
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

  @Get('places')
  @Version(V1_AND_LEGACY)
  @ApiOperation({
    summary: 'List published Place Regions.',
    description:
      'Global catalog only; no tenant coverage. Sorted by slug and ID. Pagination is not a snapshot and a cursor must be reused with the same state filter.',
  })
  @ApiResponse({ status: 200, type: PlaceListDto })
  @ApiResponse({ status: 400, description: 'Invalid query or cursor' })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid internal API key',
  })
  @ApiResponse({ status: 502, description: 'Elasticsearch request failed' })
  @ApiResponse({ status: 503, description: 'Elasticsearch timed out' })
  listPlaces(@Query() query: PlaceListQueryDto): Promise<PlaceListDto> {
    return this.regionService.listPlaces(query);
  }

  @Get('places/:slug')
  @Version(V1_AND_LEGACY)
  @ApiOperation({
    summary: 'Resolve a published Place by its canonical slug.',
    description:
      'Matches the current published canonical slug exactly. Historical, reserved and unpublished slugs are not resolved.',
  })
  @ApiResponse({ status: 200, type: PlaceDetailDto })
  @ApiResponse({ status: 400, description: 'Malformed slug' })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid internal API key',
  })
  @ApiResponse({ status: 404, description: 'No such published Place' })
  @ApiResponse({ status: 502, description: 'Elasticsearch request failed' })
  @ApiResponse({ status: 503, description: 'Elasticsearch timed out' })
  getPlace(@Param() params: PlaceSlugParamDto): Promise<PlaceDetailDto> {
    return this.regionService.getPlace(params.slug);
  }

  @Get(':id')
  @Version(V1_AND_LEGACY)
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

/** Runtime controller remains excluded from the public SDK document. */
@ApiExcludeController()
export class InternalRegionController extends RegionController {}
