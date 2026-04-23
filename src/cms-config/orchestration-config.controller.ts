import {
  Controller,
  Get,
  Query,
  UseGuards,
  Header,
  Param,
} from '@nestjs/common';
import { OrchestrationConfigService } from './orchestration-config.service';
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
          'source_column,link_entity,label,provenance\nservicecustom_keyword,service,Service Keywords,VisionLink',
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
    return this.orchestrationConfigService.getTenantLocales(tenantId);
  }
}
