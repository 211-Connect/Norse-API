import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ResourceLocationOpenApiDto {
  @ApiProperty({ example: 'Point' })
  type: string;

  @ApiProperty({ type: [Number], example: [-106.0746, 42.1485] })
  coordinates: number[];
}

export class ResourceAddressOpenApiDto {
  @ApiProperty()
  address_1: string;

  @ApiPropertyOptional()
  address_2?: string;

  @ApiProperty()
  city: string;

  @ApiProperty()
  stateProvince: string;

  @ApiProperty()
  postalCode: string;

  @ApiProperty()
  country: string;

  @ApiProperty()
  type: string;

  @ApiProperty()
  rank: number;
}

export class ResourcePhoneNumberOpenApiDto {
  @ApiProperty()
  type: string;

  @ApiProperty()
  number: string;

  @ApiProperty()
  rank: number;

  @ApiPropertyOptional()
  description?: string;
}

export class ResourceQualityLinkOpenApiDto {
  @ApiProperty()
  url: string;

  @ApiProperty()
  displayText: string;

  @ApiPropertyOptional()
  subheadingText?: string;
}

export class ResourceContactsOpenApiDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  title?: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional({ type: [ResourcePhoneNumberOpenApiDto] })
  phones?: ResourcePhoneNumberOpenApiDto[];

  @ApiProperty()
  priority: number;
}

export class ResourceTaxonomyOpenApiDto {
  @ApiPropertyOptional()
  code?: string;

  @ApiPropertyOptional()
  name?: string;
}

export class ResourceFacetOpenApiDto {
  @ApiProperty()
  code: string;

  @ApiProperty()
  taxonomyName: string;

  @ApiProperty()
  termName: string;
}

export class ResourceTranslationOpenApiDto {
  @ApiPropertyOptional()
  locale?: string;

  @ApiPropertyOptional()
  displayName?: string;

  @ApiPropertyOptional()
  serviceName?: string;

  @ApiPropertyOptional()
  serviceSummary?: string;

  @ApiPropertyOptional()
  serviceDescription?: string;

  @ApiPropertyOptional()
  organizationDescription?: string;

  @ApiPropertyOptional({ type: [String] })
  languages?: string[];

  @ApiPropertyOptional()
  hours?: string;

  @ApiPropertyOptional()
  hoursDescription?: string;

  @ApiPropertyOptional()
  fees?: string;

  @ApiPropertyOptional()
  interpretationServices?: string;

  @ApiPropertyOptional()
  applicationProcess?: string;

  @ApiPropertyOptional({ type: [String] })
  requiredDocuments?: string[];

  @ApiPropertyOptional()
  eligibilities?: string;

  @ApiPropertyOptional()
  serviceAreaDescription?: string;

  @ApiPropertyOptional()
  transportation?: string;

  @ApiPropertyOptional()
  accessibility?: string;

  @ApiPropertyOptional()
  alert?: string;

  @ApiPropertyOptional()
  alertDate?: string;

  @ApiPropertyOptional({ type: [ResourceQualityLinkOpenApiDto] })
  linkQualityUrls?: ResourceQualityLinkOpenApiDto[];

  @ApiPropertyOptional({ type: [ResourcePhoneNumberOpenApiDto] })
  phoneNumbers?: ResourcePhoneNumberOpenApiDto[];

  @ApiPropertyOptional({ type: [ResourceContactsOpenApiDto] })
  contacts?: ResourceContactsOpenApiDto[];

  @ApiPropertyOptional({ type: [ResourceTaxonomyOpenApiDto] })
  taxonomies?: ResourceTaxonomyOpenApiDto[];

  @ApiPropertyOptional({ type: [ResourceFacetOpenApiDto] })
  facets?: ResourceFacetOpenApiDto[];

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
  serviceAtLocationId?: string;

  @ApiPropertyOptional()
  originalId?: string;

  @ApiPropertyOptional()
  phone?: string;

  @ApiPropertyOptional()
  address?: string;

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

  @ApiPropertyOptional()
  locationName?: string;

  @ApiPropertyOptional({ type: [ResourceAddressOpenApiDto] })
  addresses?: ResourceAddressOpenApiDto[];

  @ApiPropertyOptional({ type: [ResourcePhoneNumberOpenApiDto] })
  phoneNumbers?: ResourcePhoneNumberOpenApiDto[];

  @ApiPropertyOptional({ type: [String] })
  languages?: string[];

  @ApiPropertyOptional()
  serviceAreaName?: string;

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
