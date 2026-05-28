import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Version,
  Delete,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiHeader,
  ApiBody,
} from '@nestjs/swagger';
import { GeocodingService } from './geocoding.service';
import { InternalApiGuard } from '../common/guards/internal-api.guard';
import {
  ForwardGeocodeQueryDto,
  ForwardGeocodeResponseDto,
  ReverseGeocodeQueryDto,
  ReverseGeocodeResponseDto,
  BatchForwardGeocodeBodyDto,
  BatchReverseGeocodeBodyDto,
  BatchForwardGeocodeResultDto,
  BatchReverseGeocodeResultDto,
} from './dto/geocoding.dto';
import { SetCdnCacheTTL } from '../common/decorators/cdn-cache-ttl.decorator';
import { ONE_MONTH } from '../common/const';

@ApiTags('Geocoding')
@Controller('geocoding')
@ApiHeader({
  name: 'x-api-version',
  description: 'API version',
  required: true,
  schema: {
    default: '1',
  },
})
export class GeocodingController {
  constructor(private readonly geocodingService: GeocodingService) {}

  @Get('forward')
  @Version('1')
  @SetCdnCacheTTL(ONE_MONTH)
  @ApiOperation({
    summary: 'Forward geocoding - convert address to coordinates',
    description:
      'Converts a human-readable address into geographic coordinates (longitude, latitude). This endpoint acts as a proxy to Mapbox API and includes caching to improve performance.',
  })
  @ApiQuery({ type: ForwardGeocodeQueryDto })
  @ApiResponse({
    status: 200,
    description: 'Successfully geocoded address',
    type: [ForwardGeocodeResponseDto],
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid address or parameters',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error',
  })
  async forwardGeocode(
    @Query() query: ForwardGeocodeQueryDto,
  ): Promise<ForwardGeocodeResponseDto[]> {
    return this.geocodingService.forwardGeocode(query);
  }

  @Get('reverse')
  @Version('1')
  @SetCdnCacheTTL(ONE_MONTH)
  @ApiOperation({
    summary: 'Reverse geocoding - convert coordinates to address',
    description:
      'Converts geographic coordinates (longitude, latitude) into a human-readable address. This endpoint acts as a proxy to Mapbox API and includes caching to improve performance.',
  })
  @ApiQuery({ type: ReverseGeocodeQueryDto })
  @ApiResponse({
    status: 200,
    description: 'Successfully reverse geocoded coordinates',
    type: [ReverseGeocodeResponseDto],
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid coordinates or parameters',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error',
  })
  async reverseGeocode(
    @Query() query: ReverseGeocodeQueryDto,
  ): Promise<ReverseGeocodeResponseDto[]> {
    return this.geocodingService.reverseGeocode(query);
  }

  @Post('forward/batch')
  @Version('1')
  @ApiOperation({
    summary:
      'Batch forward geocoding - convert multiple addresses to coordinates',
    description:
      'Accepts an array of up to 50 addresses and returns geocoding results for each. Items are processed in parallel (up to 5 concurrent requests). Failed items are returned with an error field instead of results — the overall request always returns 200.',
  })
  @ApiBody({ type: BatchForwardGeocodeBodyDto })
  @ApiResponse({
    status: 200,
    description:
      'Batch geocoding complete (partial failures are included inline)',
    type: [BatchForwardGeocodeResultDto],
  })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async batchForwardGeocode(
    @Body() body: BatchForwardGeocodeBodyDto,
  ): Promise<BatchForwardGeocodeResultDto[]> {
    return this.geocodingService.batchForwardGeocode(body);
  }

  @Post('reverse/batch')
  @Version('1')
  @ApiOperation({
    summary:
      'Batch reverse geocoding - convert multiple coordinates to addresses',
    description:
      'Accepts an array of up to 50 coordinate strings in "longitude,latitude" format and returns reverse geocoding results for each. Items are processed in parallel (up to 5 concurrent requests). Failed items are returned with an error field instead of results — the overall request always returns 200.',
  })
  @ApiBody({ type: BatchReverseGeocodeBodyDto })
  @ApiResponse({
    status: 200,
    description:
      'Batch reverse geocoding complete (partial failures are included inline)',
    type: [BatchReverseGeocodeResultDto],
  })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async batchReverseGeocode(
    @Body() body: BatchReverseGeocodeBodyDto,
  ): Promise<BatchReverseGeocodeResultDto[]> {
    return this.geocodingService.batchReverseGeocode(body);
  }

  @Delete('cache')
  @Version('1')
  @UseGuards(InternalApiGuard)
  @ApiOperation({
    summary: 'Clear geocoding cache',
    description:
      'Clears all cached geocoding results. This endpoint requires internal API authentication.',
  })
  @ApiHeader({
    name: 'x-internal-api-key',
    description: 'Internal API key for authentication',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Cache cleared successfully',
    schema: {
      type: 'object',
      properties: {
        cleared: { type: 'boolean', example: true },
        message: {
          type: 'string',
          example: 'Geocoding cache cleared successfully',
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing API key',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error',
  })
  async clearCache(): Promise<{ cleared: boolean; message: string }> {
    return this.geocodingService.clearCache();
  }
}
