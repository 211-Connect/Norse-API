import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsInt,
  IsEnum,
  Min,
  Max,
  IsNotEmpty,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { LocaleDto } from './locale.dto';
import { PartialType } from '@nestjs/mapped-types';

export enum GeocodingProvider {
  MAPBOX = 'mapbox',
  OPENCAGE = 'opencage',
}

export class ForwardGeocodeQueryDto extends PartialType(LocaleDto) {
  @ApiProperty({
    description: 'Address to geocode',
    example: '123 Main St, New York, NY',
    required: true,
  })
  @IsString()
  @IsNotEmpty({ message: 'Address is required' })
  address: string;

  @ApiProperty({
    description: 'Geocoding module to query',
    example: GeocodingProvider.MAPBOX,
    enum: GeocodingProvider,
    required: false,
    default: GeocodingProvider.MAPBOX,
  })
  @IsEnum(GeocodingProvider)
  @IsOptional()
  provider?: GeocodingProvider = GeocodingProvider.MAPBOX;

  @ApiProperty({
    description: 'Maximum number of results to return',
    example: 5,
    default: 5,
    minimum: 1,
    maximum: 10,
    required: false,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  limit?: number = 5;
}

export class ReverseGeocodeQueryDto extends PartialType(LocaleDto) {
  @ApiProperty({
    description: 'Coordinates in format "longitude,latitude"',
    example: '-74.006,40.7128',
    required: true,
  })
  @Transform(({ value }) => {
    if (typeof value !== 'string' || !value) {
      throw new Error('Coordinates must be a non-empty string');
    }

    if (!/^-?\d+\.?\d*,-?\d+\.?\d*$/.test(value)) {
      throw new Error(
        'Invalid coordinates format. Expected format: "longitude,latitude"',
      );
    }

    const [lng, lat] = value.split(',').map(Number);
    if (isNaN(lng) || isNaN(lat)) {
      throw new Error('Coordinates must be valid numbers');
    }

    return [lng, lat];
  })
  coordinates: [number, number];

  @ApiProperty({
    description: 'Geocoding module to query',
    example: GeocodingProvider.MAPBOX,
    enum: GeocodingProvider,
    required: false,
    default: GeocodingProvider.MAPBOX,
  })
  @IsEnum(GeocodingProvider)
  @IsOptional()
  provider?: GeocodingProvider = GeocodingProvider.MAPBOX;
}

export class GeocodeResponseDto {
  @ApiProperty({
    description: 'Type of the result',
    example: 'coordinates',
    enum: ['coordinates', 'invalid'],
  })
  type: 'coordinates' | 'invalid';

  @ApiProperty({
    description: 'Formatted address',
    example: '123 Main St, New York, NY 10001, United States',
  })
  address: string;

  @ApiProperty({
    description: 'Coordinates [longitude, latitude]',
    example: [-74.006, 40.7128],
    type: [Number],
  })
  coordinates: [number, number];

  @ApiProperty({
    description: 'Postcode of the location',
    example: '10001',
    required: false,
  })
  postcode?: string;

  @ApiProperty({
    description: 'Place/city name',
    example: 'New York',
    required: false,
  })
  place?: string;

  @ApiProperty({
    description: 'District name',
    example: 'Manhattan',
    required: false,
  })
  district?: string;

  @ApiProperty({
    description: 'Region/state name',
    example: 'New York',
    required: false,
  })
  region?: string;

  @ApiProperty({
    description: 'Country name',
    example: 'United States',
    required: false,
  })
  country?: string;

  @ApiProperty({
    description: 'Array of feature types',
    example: ['address'],
    type: [String],
    required: false,
  })
  place_type?: string[];

  @ApiProperty({
    description: 'Bounding box [minLng, minLat, maxLng, maxLat]',
    example: [-74.007, 40.712, -74.005, 40.714],
    type: [Number],
    required: false,
  })
  bbox?: number[];
}

export class ForwardGeocodeResponseDto extends GeocodeResponseDto {}
export class ReverseGeocodeResponseDto extends GeocodeResponseDto {}

export class BatchForwardGeocodeBodyDto extends PartialType(LocaleDto) {
  @ApiProperty({
    description: 'Array of addresses to geocode',
    example: [
      '123 Main St, New York, NY',
      '1600 Pennsylvania Ave NW, Washington, DC',
    ],
    type: [String],
    minItems: 1,
    maxItems: 50,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  addresses: string[];

  @ApiProperty({
    description: 'Geocoding provider to use',
    example: GeocodingProvider.MAPBOX,
    enum: GeocodingProvider,
    required: false,
    default: GeocodingProvider.MAPBOX,
  })
  @IsEnum(GeocodingProvider)
  @IsOptional()
  provider?: GeocodingProvider = GeocodingProvider.MAPBOX;

  @ApiProperty({
    description: 'Maximum number of results per address',
    example: 5,
    default: 5,
    minimum: 1,
    maximum: 10,
    required: false,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  limit?: number = 5;
}

export class BatchReverseGeocodeBodyDto extends PartialType(LocaleDto) {
  @ApiProperty({
    description: 'Array of coordinates in "longitude,latitude" format',
    example: ['-74.006,40.7128', '-77.0366,38.8971'],
    type: [String],
    minItems: 1,
    maxItems: 50,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  coordinates: string[];

  @ApiProperty({
    description: 'Geocoding provider to use',
    example: GeocodingProvider.MAPBOX,
    enum: GeocodingProvider,
    required: false,
    default: GeocodingProvider.MAPBOX,
  })
  @IsEnum(GeocodingProvider)
  @IsOptional()
  provider?: GeocodingProvider = GeocodingProvider.MAPBOX;
}

export class BatchForwardGeocodeResultDto {
  @ApiProperty({
    description: 'The input address',
    example: '123 Main St, New York, NY',
  })
  address: string;

  @ApiProperty({
    description: 'Geocoding results for this address',
    type: [ForwardGeocodeResponseDto],
    required: false,
  })
  results?: ForwardGeocodeResponseDto[];

  @ApiProperty({
    description: 'Error message if geocoding failed for this address',
    example: 'Failed to geocode address',
    required: false,
  })
  error?: string;
}

export class BatchReverseGeocodeResultDto {
  @ApiProperty({
    description: 'The input coordinates string',
    example: '-74.006,40.7128',
  })
  coordinates: string;

  @ApiProperty({
    description: 'Reverse geocoding results for these coordinates',
    type: [ReverseGeocodeResponseDto],
    required: false,
  })
  results?: ReverseGeocodeResponseDto[];

  @ApiProperty({
    description:
      'Error message if reverse geocoding failed for these coordinates',
    example: 'Failed to reverse geocode coordinates',
    required: false,
  })
  error?: string;
}
