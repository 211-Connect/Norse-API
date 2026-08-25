import { ApiProperty } from '@nestjs/swagger';

// OpenAPI shape for GET /organization/:id. Runtime type is OrganizationDetail.

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

  @ApiProperty({ type: OrganizationTranslationDto, nullable: true })
  translation: OrganizationTranslationDto | null;

  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description:
      'HSDS services. Use SERVICE_AT_LOCATIONS[].ID with POST /resource/batch for service-at-location detail.',
  })
  services: Record<string, unknown>[];

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  locations: Record<string, unknown>[];

  @ApiProperty({ type: 'array', items: { type: 'object' }, required: false })
  phones?: Record<string, unknown>[];
}
