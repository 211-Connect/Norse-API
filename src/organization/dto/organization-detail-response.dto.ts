import { ApiProperty } from '@nestjs/swagger';

/**
 * Swagger documentation DTO for the organization-detail response. The actual
 * runtime shape is defined by OrganizationDetail; this class exists so the
 * OpenAPI spec renders the returned org graph. The endpoint returns the org
 * object directly (no envelope), matching the /resource/:id developer
 * experience.
 */

class OrganizationTranslationDto {
  @ApiProperty({ nullable: true }) LOCALE?: string;
  @ApiProperty({ nullable: true }) DESCRIPTION?: string | null;
}

export class OrganizationDetailResponseDto {
  @ApiProperty() organizationId: string;
  @ApiProperty() tenant_id: string;
  @ApiProperty({ nullable: true }) resourceWriterId?: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true }) alternateName?: string;
  @ApiProperty({ nullable: true }) email?: string;
  @ApiProperty({ nullable: true }) website?: string;
  @ApiProperty({ nullable: true }) legalStatus?: string;

  @ApiProperty({
    type: OrganizationTranslationDto,
    nullable: true,
    description:
      'Org-level description resolved to the requested locale (or English), or null.',
  })
  translation: OrganizationTranslationDto | null;

  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description:
      'HSDS services, each with its SERVICE_AT_LOCATIONS references. Use the ' +
      'SERVICE_AT_LOCATIONS[].ID values with POST /resource/batch to fetch ' +
      'full service-at-location detail.',
  })
  services: Record<string, unknown>[];

  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description: 'HSDS locations with addresses, phones and schedules.',
  })
  locations: Record<string, unknown>[];

  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    required: false,
  })
  phones?: Record<string, unknown>[];
}
