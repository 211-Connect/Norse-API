import {
  Controller,
  Get,
  Query,
  UseGuards,
  Header,
  Param,
} from '@nestjs/common';
import { OrchestrationConfigService } from './orchestration-config.service';
import { TenantConfigService } from './tenant-config.service';
import { InternalApiGuard } from '../common/guards/internal-api.guard';
import {
  ApiTags,
  ApiResponse,
  ApiQuery,
  ApiSecurity,
  ApiParam,
} from '@nestjs/swagger';

@ApiTags('Orchestration Config')
@Controller('orchestration-config')
@UseGuards(InternalApiGuard)
@ApiSecurity('x-internal-api-key')
export class OrchestrationConfigController {
  constructor(
    private readonly orchestrationConfigService: OrchestrationConfigService,
    private readonly tenantConfigService: TenantConfigService,
  ) {}

  @Get('custom-attributes')
  @Header('Content-Type', 'text/csv')
  @ApiQuery({
    name: 'schema',
    required: false,
    description: 'Optional schema name to filter custom attributes',
    example: 'openreferral',
  })
  @ApiResponse({
    status: 200,
    description:
      'Aggregated custom attributes configuration in CSV format (deduplicated by source_column)',
    content: {
      'text/csv': {
        example:
          'source_table,source_column,link_entity,label,provenance,translate_label,translate_value\nvisionlink_service,servicecustom_keyword,service,Service Keywords,VisionLink,true,false',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or missing internal API key',
  })
  @ApiResponse({
    status: 500,
    description: 'Failed to retrieve orchestration config',
  })
  async getCustomAttributes(
    @Query('schema') schemaName?: string,
  ): Promise<string> {
    return this.orchestrationConfigService.getCustomAttributesBySchemaNameAsCsv(
      schemaName,
    );
  }

  @Get('locales/:tenantId')
  @ApiParam({
    name: 'tenantId',
    required: true,
    description: 'Tenant ID to fetch enabled locales for',
    example: '1',
  })
  @ApiResponse({
    status: 200,
    description: 'Enabled locales for the specified tenant',
    schema: {
      type: 'array',
      items: { type: 'string' },
      example: ['en', 'es', 'fr'],
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or missing internal API key',
  })
  @ApiResponse({
    status: 500,
    description: 'Failed to retrieve enabled locales',
  })
  async getTenantLocales(
    @Param('tenantId') tenantId: string,
  ): Promise<string[]> {
    return this.tenantConfigService.getTenantLocales(tenantId);
  }

  @Get('facets/:tenantId')
  @ApiParam({
    name: 'tenantId',
    required: true,
    description: 'Tenant ID to fetch facets for',
    example: '1',
  })
  @ApiResponse({
    status: 200,
    description: 'Facets configuration for the specified tenant',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          facet: { type: 'string', example: 'age_groups' },
          name: { type: 'string', example: 'Age Groups' },
        },
        additionalProperties: {
          type: 'string',
          description: 'Localized names (e.g., "es": "Grupos de edad")',
        },
      },
      example: [
        { facet: 'age_groups', name: 'Age Groups', es: 'Grupos de edad' },
        { facet: 'services', name: 'Services', es: 'Servicios' },
      ],
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or missing internal API key',
  })
  @ApiResponse({
    status: 500,
    description: 'Failed to retrieve facets',
  })
  async getTenantFacets(@Param('tenantId') tenantId: string) {
    return this.tenantConfigService.getFacets(tenantId);
  }

  @Get(':tenantId')
  @ApiParam({
    name: 'tenantId',
    required: true,
    description:
      'Tenant ID to fetch complete configuration for (locales + facets)',
    example: '1',
  })
  @ApiResponse({
    status: 200,
    description: 'Complete tenant configuration including locales and facets',
    schema: {
      type: 'object',
      properties: {
        locales: {
          type: 'array',
          items: { type: 'string' },
          example: ['en', 'es', 'fr'],
        },
        facets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              facet: { type: 'string' },
              name: { type: 'string' },
            },
          },
          example: [
            { facet: 'age_groups', name: 'Age Groups', es: 'Grupos de edad' },
          ],
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or missing internal API key',
  })
  @ApiResponse({
    status: 500,
    description: 'Failed to retrieve tenant configuration',
  })
  async getAllTenantConfig(@Param('tenantId') tenantId: string) {
    return this.orchestrationConfigService.getAllTenantConfig(tenantId);
  }
}
