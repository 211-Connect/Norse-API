import { Controller, Get, Query, Version } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiHeader,
} from '@nestjs/swagger';
import { GeocodingService } from './geocoding.service';
import {
  ForwardGeocodeQueryDto,
  ForwardGeocodeResponseDto,
  ReverseGeocodeQueryDto,
  ReverseGeocodeResponseDto,
} from './dto/geocoding.dto';

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
}
