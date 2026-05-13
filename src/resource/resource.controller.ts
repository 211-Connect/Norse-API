import { Controller, Get, Param, Post, Body, Version } from '@nestjs/common';
import { ResourceService } from './resource.service';
import { MetricsService } from 'src/metrics/metrics.service';
import {
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CustomHeaders } from 'src/common/decorators/CustomHeaders';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation-pipe';
import { HeadersDto, headersSchema } from 'src/common/dto/headers.dto';
import { SetCdnCacheTTL } from 'src/common/decorators/cdn-cache-ttl.decorator';
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

@ApiTags('Resource')
@Controller('resource')
export class ResourceController {
  constructor(
    private readonly resourceService: ResourceService,
    private readonly metricsService: MetricsService,
  ) {}

  @Get(':id')
  @Version('1')
  @SetCdnCacheTTL(FIFTEEN_MINUTES)
  @ApiHeader({ name: 'accept-language', required: true })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'id' })
  @ApiResponse({
    status: 200,
    example: RESOURCE_EXAMPLE,
  })
  getResourceById(
    @Param('id') id: string,
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
  ): Promise<TransformedResource> {
    this.metricsService.incrementResourceHit(
      'GET',
      'getResourceById',
      headers['x-tenant-id'],
    );

    return this.resourceService.findById(id, {
      headers,
    });
  }

  @Get('original/:id')
  @SetCdnCacheTTL(FIFTEEN_MINUTES)
  @Version('1')
  @ApiHeader({ name: 'accept-language', required: true })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiParam({ name: 'id', description: 'Original Resource ID' }) // Updated description
  @ApiResponse({
    status: 200,
    example: RESOURCE_EXAMPLE,
  })
  getResourceByOriginalId(
    @Param('id') id: string, // The path parameter named id, but it is original ID
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
  ): Promise<TransformedResource> {
    this.metricsService.incrementResourceHit(
      'GET',
      'getResourceByOriginalId',
      headers['x-tenant-id'],
    );

    return this.resourceService.findByOriginalId(id, {
      headers,
    });
  }

  @Post('titles')
  @Version('1')
  @ApiHeader({ name: 'x-tenant-id', required: true })
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
  ): Promise<{ id: string; displayName: string }[]> {
    return this.resourceService.findTitlesByIds(dto.ids);
  }

  @Post('batch')
  @Version('1')
  @SetCdnCacheTTL(FIFTEEN_MINUTES)
  @ApiHeader({ name: 'accept-language', required: true })
  @ApiHeader({ name: 'x-tenant-id', required: true })
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
    this.metricsService.incrementResourceHit(
      'POST',
      'getResourcesBatch',
      headers['x-tenant-id'],
    );

    return this.resourceService.findManyByIds(dto.ids, { headers });
  }
}
