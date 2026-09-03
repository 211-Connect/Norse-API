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
import { MetricsService } from 'src/metrics/metrics.service';
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
    private readonly metrics: MetricsService,
  ) {}

  @Get()
  @Version('1')
  @ApiHeader({ name: 'x-tenant-id', required: true })
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
    this.metrics.incrementSearchHit(
      'GET',
      'organizationSearch',
      headers['x-tenant-id'],
    );
    return this.service.search({ headers, query });
  }

  @Get(':id')
  @Version('1')
  @UseGuards(ArcjetGuard)
  @SetCdnCacheTTL(FIFTEEN_MINUTES)
  @ApiTenantIdQuery()
  @ApiLocaleQuery()
  @ApiHeader({ name: 'accept-language', required: true })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'id', description: 'Public organizationId' })
  @ApiResponse({ status: 200, type: OrganizationDetailResponseDto })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  getOrganizationById(
    @Param('id') id: string,
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
  ) {
    this.metrics.incrementSearchHit(
      'GET',
      'organizationDetail',
      headers['x-tenant-id'],
    );
    return this.detailService.findById(id, { headers });
  }
}
