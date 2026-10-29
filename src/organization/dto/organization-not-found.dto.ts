import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The 404 body for GET /organization/:id, as the global HttpExceptionFilter
 * writes it. `redirect` is present only when the id was re-keyed and this
 * tenant has a redirect row for it (ISS-2517).
 */
export class OrganizationNotFoundResponseDto {
  @ApiProperty({ example: 404 })
  status: number;

  @ApiProperty({ example: 'Not Found' })
  message: string;

  @ApiProperty({
    description: 'The request path',
    example: '/organization/9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
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
      'Where the organization lives now, when its id was re-keyed: a Norse path relative to the locale, the org-scoped search `/search?organization_id=<new organizationId>`. Absent when the id is simply unknown.',
    example: '/search?organization_id=0f1e2d3c-4b5a-4968-8776-655443322110',
  })
  redirect?: string;
}
