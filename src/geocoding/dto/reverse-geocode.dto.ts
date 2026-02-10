import { z } from 'zod';
import { ApiProperty } from '@nestjs/swagger';
import { GeocodingContextDto } from './forward-geocode.dto';

export const reverseGeocodeQuerySchema = z.object({
  coordinates: z
    .string()
    .regex(/^-?\d+\.?\d*,-?\d+\.?\d*$/, 'Invalid coordinates format')
    .transform((val) => {
      const [lng, lat] = val.split(',').map(Number);
      return [lng, lat] as [number, number];
    }),
  locale: z.string().default('en'),
});

export type ReverseGeocodeQueryDto = z.infer<typeof reverseGeocodeQuerySchema>;

export class ReverseGeocodeQuerySwagger {
  @ApiProperty({
    description: 'Coordinates in format "longitude,latitude"',
    example: '-74.006,40.7128',
    required: true,
  })
  coordinates: string;

  @ApiProperty({
    description: 'Language locale for the response',
    example: 'en',
    default: 'en',
    required: false,
  })
  locale?: string;
}

export class ReverseGeocodeResponseDto extends GeocodingContextDto {
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
