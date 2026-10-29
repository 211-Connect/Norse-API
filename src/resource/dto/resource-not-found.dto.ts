import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The 404 body for a single-resource lookup, as the global
 * HttpExceptionFilter writes it. `redirect` is present only when the id was
 * re-keyed and this tenant has a redirect row for it (ISS-2514).
 */
export class ResourceNotFoundResponseDto {
  @ApiProperty({ example: 404 })
  status: number;

  @ApiProperty({ example: 'Not Found' })
  message: string;

  @ApiProperty({
    description: 'The request path',
    example: '/resource/550e8400-e29b-41d4-a716-446655440000',
  })
  path: string;

  @ApiProperty({ example: 'GET' })
  method: string;

  @ApiPropertyOptional({
    description: 'The tenant id the request was made for',
    example: '9b2f3c4d-1e2f-4a5b-8c7d-6e5f4a3b2c1d',
  })
  tenant?: string;

  @ApiPropertyOptional({
    description:
      'Where the record lives now, when its id was re-keyed: a Norse path relative to the locale, `/search/<new service-at-location id>`. Absent when the id is simply unknown.',
    example: '/search/0f1e2d3c-4b5a-4968-8776-655443322110',
  })
  redirect?: string;
}
