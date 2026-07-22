import {
  Controller,
  Get,
  Query,
  ValidationPipe,
  Version,
} from '@nestjs/common';
import { ApiHeader, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CustomHeaders } from 'src/common/decorators/CustomHeaders';
import { HeadersDto, headersSchema } from 'src/common/dto/headers.dto';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation-pipe';
import { MetricsService } from 'src/metrics/metrics.service';
import { SearchOrganizationQueryDto } from './dto/search-organization-query.dto';
import { OrganizationSearchResponseDto } from './dto/search-organization-response.dto';
import { OrganizationService } from './organization.service';

@ApiTags('Organization')
@Controller('organization')
export class OrganizationController {
  constructor(
    private readonly service: OrganizationService,
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
}
