import { z } from 'zod';
import { ApiProperty } from '@nestjs/swagger';

export const forwardGeocodeQuerySchema = z.object({
  address: z.string().min(1, 'Address is required'),
  locale: z.string().default('en'),
  limit: z.coerce.number().int().positive().max(10).default(5),
});

export type ForwardGeocodeQueryDto = z.infer<typeof forwardGeocodeQuerySchema>;

export class ForwardGeocodeQuerySwagger {
  @ApiProperty({
    description: 'Address to geocode',
    example: '123 Main St, New York, NY',
    required: true,
  })
  address: string;

  @ApiProperty({
    description: 'Language locale for the response',
    example: 'en',
    default: 'en',
    required: false,
  })
  locale?: string;

  @ApiProperty({
    description: 'Maximum number of results to return',
    example: 5,
    default: 5,
    minimum: 1,
    maximum: 10,
    required: false,
  })
  limit?: number;
}

export class GeocodingContextDto {
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
}

export class ForwardGeocodeResponseDto extends GeocodingContextDto {
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
}
