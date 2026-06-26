import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseBoolPipe,
  Post,
  Put,
  Query,
  UseGuards,
  ValidationPipe,
  Version,
} from '@nestjs/common';
import {
  ApiExtraModels,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { InternalApiGuard } from 'src/common/guards/internal-api.guard';
import { SearchScorecardTaxonomiesQueryDto } from './dto/search-scorecard-taxonomies-query.dto';
import { SearchScorecardTaxonomiesResponseDto } from './dto/search-scorecard-taxonomies-response.dto';
import { UpdateTaxonomyScorecardDto } from './dto/update-taxonomy-scorecard.dto';
import { EnableTaxonomyScorecardDto } from './dto/enable-taxonomy-scorecard.dto';
import { TaxonomyScorecardService } from './taxonomy-scorecard.service';
import { UpdateTaxonomyScorecardResponseDto } from './dto/update-taxonomy-scorecard-response.dto';
import {
  ScorecardNeedResponseDto,
  ScorecardVersionEntryResponseDto,
  TaxonomyScorecardPayloadResponseDto,
  TaxonomyScorecardResponseDto,
  TaxonomySourceResponseDto,
  VersionMetadataResponseDto,
} from './dto/taxonomy-scorecard-response.dto';

@ApiTags('Taxonomy Scorecard')
@Controller('taxonomy-scorecard')
@UseGuards(InternalApiGuard)
@ApiSecurity('x-internal-api-key')
@ApiHeader({
  name: 'x-api-version',
  required: true,
  schema: { default: '1' },
})
@ApiExtraModels(
  TaxonomyScorecardResponseDto,
  TaxonomyScorecardPayloadResponseDto,
  ScorecardNeedResponseDto,
  TaxonomySourceResponseDto,
  ScorecardVersionEntryResponseDto,
  VersionMetadataResponseDto,
)
export class TaxonomyScorecardController {
  constructor(
    private readonly taxonomyScorecardService: TaxonomyScorecardService,
  ) {}

  @Get('taxonomies')
  @Version('1')
  @ApiOperation({
    summary: 'Search HSIS taxonomies for scorecard customization',
  })
  @ApiResponse({
    status: 200,
    type: SearchScorecardTaxonomiesResponseDto,
  })
  @ApiQuery({ name: 'tenant_id', required: true })
  @ApiQuery({ name: 'query', required: true })
  @ApiQuery({ name: 'page', required: false, schema: { default: 1 } })
  @ApiQuery({ name: 'limit', required: false, schema: { default: 10 } })
  async searchTaxonomies(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: SearchScorecardTaxonomiesQueryDto,
  ): Promise<SearchScorecardTaxonomiesResponseDto> {
    return this.taxonomyScorecardService.searchTaxonomies(query);
  }

  @Get('tenants/:tenantId/taxonomies/:hsisCode')
  @Version('1')
  @ApiOperation({
    summary: 'Get effective taxonomy scorecard configuration for tenant',
  })
  @ApiParam({ name: 'tenantId' })
  @ApiParam({ name: 'hsisCode' })
  @ApiResponse({ status: 200, type: TaxonomyScorecardResponseDto })
  async getTaxonomyConfiguration(
    @Param('tenantId') tenantId: string,
    @Param('hsisCode') hsisCode: string,
  ): Promise<TaxonomyScorecardResponseDto> {
    return this.taxonomyScorecardService.getTaxonomyConfiguration(
      tenantId,
      hsisCode,
    );
  }

  @Put('tenants/:tenantId/taxonomies/:hsisCode')
  @Version('1')
  @ApiOperation({
    summary: 'Update tenant taxonomy scorecard configuration',
  })
  @ApiParam({ name: 'tenantId' })
  @ApiParam({ name: 'hsisCode' })
  @ApiQuery({
    name: 'draft',
    required: false,
    schema: { type: 'boolean', default: false },
    description:
      'When true, saves new version as draft only and keeps active version unchanged',
  })
  @ApiResponse({ status: 200, type: UpdateTaxonomyScorecardResponseDto })
  async updateTaxonomyConfiguration(
    @Param('tenantId') tenantId: string,
    @Param('hsisCode') hsisCode: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: UpdateTaxonomyScorecardDto,
    @Query('draft', new DefaultValuePipe(false), ParseBoolPipe)
    draft: boolean,
  ): Promise<UpdateTaxonomyScorecardResponseDto> {
    return this.taxonomyScorecardService.updateTaxonomyConfiguration(
      tenantId,
      hsisCode,
      body,
      draft,
    );
  }

  @Post('tenants/:tenantId/taxonomies/:hsisCode/enable')
  @Version('1')
  @ApiOperation({
    summary: 'Enable tenant taxonomy scorecard version',
  })
  @ApiParam({ name: 'tenantId' })
  @ApiParam({ name: 'hsisCode' })
  @ApiResponse({ status: 200, type: TaxonomyScorecardResponseDto })
  async enableTaxonomyScorecardVersion(
    @Param('tenantId') tenantId: string,
    @Param('hsisCode') hsisCode: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body: EnableTaxonomyScorecardDto,
  ): Promise<TaxonomyScorecardResponseDto> {
    return this.taxonomyScorecardService.enableTaxonomyScorecardVersion(
      tenantId,
      hsisCode,
      body,
    );
  }
}
