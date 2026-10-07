import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ValidationPipe,
  Version,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CustomHeaders } from 'src/common/decorators/CustomHeaders';
import { ApiLocaleQuery, ApiTenantIdQuery } from 'src/common/decorators';
import { SetCdnCacheTTL } from 'src/common/decorators/cdn-cache-ttl.decorator';
import { FIFTEEN_MINUTES } from 'src/common/const';
import { ArcjetGuard } from 'src/common/guards/arcjet.guard';
import { HeadersDto, headersSchema } from 'src/common/dto/headers.dto';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation-pipe';
import { X_TENANT_ID_HEADER_DESCRIPTION } from 'src/common/swagger/header-descriptions';
import { SearchOrganizationQueryDto } from './dto/search-organization-query.dto';
import { OrganizationSearchResponseDto } from './dto/search-organization-response.dto';
import { OrganizationDetailResponseDto } from './dto/organization-detail-response.dto';
import { OrganizationService } from './organization.service';
import { OrganizationDetailService } from './organization-detail.service';

@ApiTags('Organization')
@Controller('organization')
export class OrganizationController {
  constructor(
    private readonly service: OrganizationService,
    private readonly detailService: OrganizationDetailService,
  ) {}

  @Get()
  @Version('1')
  @ApiHeader({
    name: 'x-tenant-id',
    required: true,
    description: X_TENANT_ID_HEADER_DESCRIPTION,
  })
  @ApiHeader({
    name: 'accept-language',
    required: false,
    schema: { default: 'en' },
  })
  @ApiQuery({
    name: 'query',
    required: true,
    description: 'Organization name prefix or text for typeahead search',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    schema: { default: 1, minimum: 1 },
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { default: 10, minimum: 1, maximum: 50 },
  })
  @ApiResponse({ status: 200, type: OrganizationSearchResponseDto })
  search(
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: SearchOrganizationQueryDto,
  ) {
    return this.service.search({ headers, query });
  }

  @Get('by-service-at-location/:salId')
  @Version('1')
  @UseGuards(ArcjetGuard)
  @SetCdnCacheTTL(FIFTEEN_MINUTES)
  @ApiTenantIdQuery()
  @ApiLocaleQuery()
  @ApiHeader({ name: 'accept-language', required: true })
  @ApiHeader({
    name: 'x-tenant-id',
    required: true,
    description: X_TENANT_ID_HEADER_DESCRIPTION,
  })
  @ApiOperation({
    summary: 'Organization that offers a service-at-location, in this tenant',
    description:
      'Resolves the one organization in the x-tenant-id tenant whose services carry this service@location id. Tenant-scoped only: no cross-tenant or legacy-id fallback. The same SAL id can belong to different organization documents in different tenants, so the tenant is required.',
  })
  @ApiParam({
    name: 'salId',
    description: 'service@location id (services[].SERVICE_AT_LOCATIONS[].ID)',
  })
  @ApiResponse({ status: 200, type: OrganizationDetailResponseDto })
  @ApiResponse({
    status: 404,
    description: 'No organization in this tenant carries the service@location',
  })
  @ApiResponse({
    status: 409,
    description:
      'More than one organization in this tenant carries the service@location',
  })
  getOrganizationByServiceAtLocation(
    @Param('salId') salId: string,
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
  ) {
    return this.detailService.findByServiceAtLocation(salId, { headers });
  }

  @Get(':id')
  @Version('1')
  @UseGuards(ArcjetGuard)
  @SetCdnCacheTTL(FIFTEEN_MINUTES)
  @ApiTenantIdQuery()
  @ApiLocaleQuery()
  @ApiHeader({ name: 'accept-language', required: true })
  @ApiHeader({
    name: 'x-tenant-id',
    required: true,
    description: X_TENANT_ID_HEADER_DESCRIPTION,
  })
  @ApiParam({ name: 'id', description: 'Public organizationId' })
  @ApiResponse({ status: 200, type: OrganizationDetailResponseDto })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  getOrganizationById(
    @Param('id') id: string,
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
  ) {
    return this.detailService.findById(id, { headers });
  }
}
