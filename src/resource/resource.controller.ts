import {
  Controller,
  Get,
  Param,
  Post,
  Version,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import {
  UsageMetricsService,
  resourceOutcomeFromError,
} from 'src/metrics/usage-metrics.service';
import { ResourceService } from './resource.service';
import {
  ApiBody,
  ApiExtraModels,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CustomHeaders } from 'src/common/decorators/CustomHeaders';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation-pipe';
import { HeadersDto, headersSchema } from 'src/common/dto/headers.dto';
import { ApiTenantIdQuery, ApiLocaleQuery } from 'src/common/decorators';
import { SetCacheTTL } from 'src/common/decorators/cache-ttl.decorator';
import { FIFTEEN_MINUTES } from 'src/common/const';
import { ResourceTitlesDto } from './dto/resource-titles.dto';
import {
  ResourceBatchDto,
  ResourceBatchResponseDto,
} from './dto/resource-batch.dto';
import { RESOURCE_EXAMPLE } from './dto/resource-examples';
import {
  TransformedResource,
  ResourceBatchResponse,
} from './types/resource-response.types';
import { TransformedResourceOpenApiDto } from './dto/transformed-resource.openapi.dto';
import { ArcjetGuard } from 'src/common/guards/arcjet.guard';
import { X_TENANT_ID_HEADER_DESCRIPTION } from 'src/common/swagger/header-descriptions';

@ApiTags('Resource')
@ApiExtraModels(TransformedResourceOpenApiDto)
@Controller('resource')
@ApiTenantIdQuery()
@ApiLocaleQuery()
export class ResourceController {
  constructor(
    private readonly resourceService: ResourceService,
    private readonly usageMetrics: UsageMetricsService,
  ) {}

  @Get(':id')
  @Version('1')
  @UseGuards(ArcjetGuard)
  @SetCacheTTL(FIFTEEN_MINUTES)
  @ApiHeader({ name: 'accept-language', required: true })
  @ApiHeader({
    name: 'x-tenant-id',
    required: true,
    description: X_TENANT_ID_HEADER_DESCRIPTION,
  })
  @ApiParam({ name: 'id' })
  @ApiResponse({
    status: 200,
    type: TransformedResourceOpenApiDto,
    example: RESOURCE_EXAMPLE,
  })
  async getResourceById(
    @Param('id') id: string,
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
    @Req() req: Request,
  ): Promise<TransformedResource> {
    return this.trackResource(
      req,
      this.resourceService.findById(id, {
        headers,
      }),
    );
  }

  @Get('original/:id')
  @SetCacheTTL(FIFTEEN_MINUTES)
  @Version('1')
  @UseGuards(ArcjetGuard)
  @ApiHeader({ name: 'accept-language', required: true })
  @ApiHeader({
    name: 'x-tenant-id',
    required: true,
    description: X_TENANT_ID_HEADER_DESCRIPTION,
  })
  @ApiParam({ name: 'id', description: 'Original Resource ID' }) // Updated description
  @ApiResponse({
    status: 200,
    type: TransformedResourceOpenApiDto,
    example: RESOURCE_EXAMPLE,
  })
  getResourceByOriginalId(
    @Param('id') id: string, // The path parameter named id, but it is original ID
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
    @Req() req: Request,
  ): Promise<TransformedResource> {
    return this.trackResource(
      req,
      this.resourceService.findByOriginalId(id, {
        headers,
      }),
    );
  }

  @Post('titles')
  @Version('1')
  @ApiHeader({
    name: 'x-tenant-id',
    required: true,
    description: X_TENANT_ID_HEADER_DESCRIPTION,
  })
  @ApiOperation({
    summary: 'Get resource titles by IDs',
    description:
      'Returns display titles for the provided list of resource UUIDs.',
  })
  @ApiBody({ type: ResourceTitlesDto })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved resource titles',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request body',
  })
  getResourceTitlesByIds(
    @Body() dto: ResourceTitlesDto,
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
  ): Promise<{ id: string; displayName: string }[]> {
    return this.resourceService.findTitlesByIds(
      dto.ids,
      headers['x-tenant-id'],
    );
  }

  @Post('batch')
  @Version('1')
  @SetCacheTTL(FIFTEEN_MINUTES)
  @ApiHeader({ name: 'accept-language', required: true })
  @ApiHeader({
    name: 'x-tenant-id',
    required: true,
    description: X_TENANT_ID_HEADER_DESCRIPTION,
  })
  @ApiOperation({
    summary: 'Batch fetch resources by IDs',
    description:
      'Fetches multiple resources by their UUIDs. Returns a structured response with successful resources and errors for failed IDs. Supports partial success.',
  })
  @ApiBody({ type: ResourceBatchDto })
  @ApiResponse({
    status: 200,
    description: 'Batch operation completed (may include partial failures)',
    type: ResourceBatchResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request body',
  })
  async getResourcesBatch(
    @Body() dto: ResourceBatchDto,
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
  ): Promise<ResourceBatchResponse> {
    return this.resourceService.findManyByIds(dto.ids, { headers });
  }

  /**
   * Records the usage counter once the lookup settles: `found` on a document,
   * `not_found` for a 404, `error` for anything else.
   */
  private async trackResource<T>(
    req: Request | undefined,
    pending: Promise<T>,
  ): Promise<T> {
    const context = {
      tenantId: req?.tenantId,
      acceptLanguage: req?.headers?.['accept-language'],
    };
    try {
      const resource = await pending;
      this.usageMetrics.recordResourceRequest(context, 'found');
      return resource;
    } catch (error) {
      this.usageMetrics.recordResourceRequest(
        context,
        resourceOutcomeFromError(error),
      );
      throw error;
    }
  }
}
