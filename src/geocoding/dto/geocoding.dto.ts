import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsNotEmpty,
  Matches,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { LocaleDto } from './locale.dto';
import { PartialType } from '@nestjs/mapped-types';

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
  @IsString()
  @IsNotEmpty()
  @Matches(/^-?\d+\.?\d*,-?\d+\.?\d*$/, {
    message: 'Invalid coordinates format',
  })
  @Transform(({ value }) => {
    const [lng, lat] = value.split(',').map(Number);
    return [lng, lat];
  })
  coordinates: [number, number];
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
