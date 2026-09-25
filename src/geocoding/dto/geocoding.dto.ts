import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsInt,
  IsEnum,
  IsArray,
  Min,
  Max,
  IsNotEmpty,
  ArrayMinSize,
  ArrayMaxSize,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { LocaleDto } from './locale.dto';
import { PartialType } from '@nestjs/mapped-types';

export enum GeocodingProvider {
  MAPBOX = 'mapbox',
  OPENCAGE = 'opencage',
}

/** Mapbox Geocoding v5 feature types. */
export enum GeocodingPlaceType {
  COUNTRY = 'country',
  REGION = 'region',
  POSTCODE = 'postcode',
  DISTRICT = 'district',
  PLACE = 'place',
  LOCALITY = 'locality',
  NEIGHBORHOOD = 'neighborhood',
  ADDRESS = 'address',
  POI = 'poi',
}

@ValidatorConstraint({ name: 'lngLat' })
class LngLatConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      Array.isArray(value) &&
      value.length === 2 &&
      value.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
      Math.abs(value[0]) <= 180 &&
      Math.abs(value[1]) <= 90
    );
  }

  defaultMessage(): string {
    return 'proximity must be "longitude,latitude" with longitude in ±180 and latitude in ±90';
  }
}

const commaList = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : value;

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

  @ApiProperty({
    description: `Comma-separated feature types to return, from: ${Object.values(GeocodingPlaceType).join(', ')}. Mapbox only; with the OpenCage provider this is a 400.`,
    example: 'address,poi',
    required: false,
    type: String,
  })
  @Transform(commaList)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(Object.values(GeocodingPlaceType).length)
  @IsEnum(GeocodingPlaceType, { each: true })
  @IsOptional()
  types?: GeocodingPlaceType[];

  @ApiProperty({
    description:
      'Bias results toward this point, as "longitude,latitude". Mapbox only; OpenCage ignores it.',
    example: '-78.8986,35.994',
    required: false,
    type: String,
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',').map(Number) : value,
  )
  @Validate(LngLatConstraint)
  @IsOptional()
  proximity?: [number, number];
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
