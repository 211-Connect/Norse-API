import { Controller, Get, Query, UseGuards, Header } from '@nestjs/common';
import { CustomAttributesConfigService } from './custom-attributes-config.service';
import { InternalApiGuard } from '../common/guards/internal-api.guard';
import { ApiTags, ApiResponse, ApiQuery, ApiSecurity } from '@nestjs/swagger';

@ApiTags('Custom Attributes Config')
@Controller('custom-attributes-config')
@UseGuards(InternalApiGuard)
@ApiSecurity('x-internal-api-key')
export class CustomAttributesConfigController {
  constructor(private readonly configService: CustomAttributesConfigService) {}

  @Get('custom-attributes')
  @Header('Content-Type', 'text/csv')
  @ApiQuery({
    name: 'tenantId',
    required: true,
    description: 'The tenant ID for which to retrieve custom attributes',
    example: '507f1f77bcf86cd799439011',
  })
  @ApiResponse({
    status: 200,
    description: 'Custom attributes configuration in CSV format',
    content: {
      'text/csv': {
        example:
          'source_column,link_entity,label,provenance\nsitesystem_emailaddress,location,Site Email Address,VisionLink',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or missing internal API key',
  })
  @ApiResponse({
    status: 500,
    description: 'Failed to retrieve custom attributes',
  })
  async getCustomAttributes(
    @Query('tenantId') tenantId: string,
  ): Promise<string> {
    return this.configService.getCustomAttributesAsCsv(tenantId);
  }
}
