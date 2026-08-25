import { ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { TransformedResourceOpenApiDto } from 'src/resource/dto/transformed-resource.openapi.dto';

/**
 * Swagger documentation DTOs for the organization-detail response. The actual
 * runtime shape is defined by OrganizationDetailResponse; these classes exist
 * so the OpenAPI spec renders the envelope and the sideloaded resource map.
 */

class OrganizationTranslationDto {
  @ApiProperty({ nullable: true }) LOCALE?: string;
  @ApiProperty({ nullable: true }) DESCRIPTION?: string | null;
}

class OrganizationDetailDataDto {
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
      'HSDS services, each with its SERVICE_AT_LOCATIONS references.',
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

class OrganizationIncludedDto {
  @ApiProperty({
    description:
      'Sideloaded resources keyed by serviceAtLocationId (JSON:API include pattern).',
    type: 'object',
    additionalProperties: {
      $ref: getSchemaPath(TransformedResourceOpenApiDto),
    },
  })
  resources: Record<string, unknown>;
}

class OrganizationResourcesMetaDto {
  @ApiProperty({ example: 2 }) requested: number;
  @ApiProperty({ example: 2 }) successful: number;
  @ApiProperty({ example: 0 }) failed: number;
  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description: 'Per-ID errors from the batch hydration (if any).',
  })
  errors: Record<string, unknown>[];
}

class OrganizationIncludeMetaDto {
  @ApiProperty({ type: OrganizationResourcesMetaDto, required: false })
  resources?: OrganizationResourcesMetaDto;
}

export class OrganizationDetailResponseDto {
  @ApiProperty({ type: OrganizationDetailDataDto })
  data: OrganizationDetailDataDto;

  @ApiProperty({
    type: OrganizationIncludedDto,
    required: false,
    description: 'Present only when ?include=resources was requested.',
  })
  included?: OrganizationIncludedDto;

  @ApiProperty({
    type: OrganizationIncludeMetaDto,
    required: false,
    description: 'Summary of each requested include. Present with ?include.',
  })
  meta?: OrganizationIncludeMetaDto;
}
