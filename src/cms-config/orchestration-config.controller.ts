import { Controller, Get, Query, UseGuards, Header } from '@nestjs/common';
import { OrchestrationConfigService } from './orchestration-config.service';
import { InternalApiGuard } from '../common/guards/internal-api.guard';
import { ApiTags, ApiResponse, ApiQuery, ApiSecurity } from '@nestjs/swagger';

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
    return this.orchestrationConfigService.getCustomAttributes(schemaName);
  }
}
