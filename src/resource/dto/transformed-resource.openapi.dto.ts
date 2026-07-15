import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ResourceLocationOpenApiDto {
  @ApiProperty({ example: 'Point' })
  type: string;

  @ApiProperty({ type: [Number], example: [-106.0746, 42.1485] })
  coordinates: number[];
}

export class ResourceAddressOpenApiDto {
  @ApiPropertyOptional()
  address_1?: string;

  @ApiPropertyOptional()
  address_2?: string;

  @ApiPropertyOptional()
  city?: string;

  @ApiPropertyOptional()
  stateProvince?: string;

  @ApiPropertyOptional()
  postalCode?: string;

  @ApiPropertyOptional()
  country?: string;

  @ApiPropertyOptional()
  type?: string;

  @ApiPropertyOptional()
  rank?: number;
}

export class ResourcePhoneNumberOpenApiDto {
  @ApiPropertyOptional()
  type?: string;

  @ApiPropertyOptional()
  number?: string;

  @ApiPropertyOptional()
  rank?: number;
}

export class ResourceTaxonomyOpenApiDto {
  @ApiPropertyOptional()
  code?: string;

  @ApiPropertyOptional()
  name?: string;
}

export class ResourceFacetOpenApiDto {
  @ApiPropertyOptional()
  code?: string;

  @ApiPropertyOptional()
  taxonomyName?: string;

  @ApiPropertyOptional()
  termName?: string;
}

export class ResourceTranslationOpenApiDto {
  @ApiPropertyOptional()
  locale?: string;

  @ApiPropertyOptional()
  displayName?: string;

  @ApiPropertyOptional()
  serviceName?: string;

  @ApiPropertyOptional()
  serviceDescription?: string;

  @ApiPropertyOptional()
  organizationDescription?: string;

  @ApiPropertyOptional()
  hours?: string;

  @ApiPropertyOptional()
  fees?: string;

  @ApiPropertyOptional()
  alert?: string;

  @ApiPropertyOptional({ type: [ResourceTaxonomyOpenApiDto] })
  taxonomies?: ResourceTaxonomyOpenApiDto[];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
  })
  attributeValues?: Record<string, unknown>;
}

export class TransformedResourceOpenApiDto {
  @ApiProperty()
  _id: string;

  @ApiPropertyOptional()
  originalId?: string;

  @ApiPropertyOptional()
  displayName?: string;

  @ApiPropertyOptional()
  displayPhoneNumber?: string;

  @ApiPropertyOptional()
  website?: string;

  @ApiPropertyOptional()
  organizationUrl?: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional()
  organizationName?: string;

  @ApiPropertyOptional({ type: ResourceLocationOpenApiDto })
  location?: ResourceLocationOpenApiDto;

  @ApiPropertyOptional({ type: [ResourceAddressOpenApiDto] })
  addresses?: ResourceAddressOpenApiDto[];

  @ApiPropertyOptional({ type: [ResourcePhoneNumberOpenApiDto] })
  phoneNumbers?: ResourcePhoneNumberOpenApiDto[];

  @ApiPropertyOptional({ type: [String] })
  languages?: string[];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Service area geometry + metadata',
  })
  serviceArea?: Record<string, unknown>;

  @ApiPropertyOptional()
  attribution?: string;

  @ApiPropertyOptional()
  createdAt?: string;

  @ApiPropertyOptional()
  updatedAt?: string;

  @ApiPropertyOptional()
  lastAssuredDate?: string;

  @ApiPropertyOptional()
  tenantId?: string;

  @ApiPropertyOptional()
  tenant_id?: string;

  @ApiPropertyOptional({ type: ResourceTranslationOpenApiDto })
  translation?: ResourceTranslationOpenApiDto;

  @ApiPropertyOptional({ type: [ResourceFacetOpenApiDto] })
  facetsEn?: ResourceFacetOpenApiDto[];
}
