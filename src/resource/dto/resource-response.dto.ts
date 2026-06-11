import { ApiProperty, PickType } from '@nestjs/swagger';
import {
  Facet,
  PhoneNumber,
  ResourceTranslation,
} from '../types/resource-response.types';
import {
  ResourceAddressDto,
  LinkQualityUrlDto,
  ResourceContactDto,
  ResourceFacetDto,
  ResourceLocationDto,
  ResourcePhoneNumberDto,
  ResourceServiceAreaDto,
  ResourceTaxonomyDto,
} from './resource-components.dto';

export class ResourceBaseDto {
  @ApiProperty()
  originalId: string;

  @ApiProperty()
  _id: string;

  @ApiProperty()
  displayName: string;

  @ApiProperty()
  displayPhonenumber: string;

  @ApiProperty()
  website: string;

  @ApiProperty()
  organizationUrl: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ type: [ResourcePhoneNumberDto] })
  phoneNumbers: PhoneNumber[];

  @ApiProperty()
  hours: string;

  @ApiProperty()
  applicationProcess: string;

  @ApiProperty()
  eligibilities: string;

  @ApiProperty({ type: [String] })
  languages: string[];

  @ApiProperty()
  fees: string;

  @ApiProperty()
  requiredDocuments: string;

  @ApiProperty()
  tenantId: string;

  @ApiProperty({ type: ResourceLocationDto })
  location: ResourceLocationDto;

  @ApiProperty({ type: ResourceServiceAreaDto })
  serviceArea: ResourceServiceAreaDto;

  @ApiProperty()
  organizationName: string;

  @ApiProperty({ type: [ResourceAddressDto] })
  addresses: ResourceAddressDto[];

  @ApiProperty()
  last_assured_date: string;
}

export class ResourceTranslationDto implements ResourceTranslation {
  @ApiProperty()
  displayName: string;

  @ApiProperty({ required: false })
  fees?: string;

  @ApiProperty({ required: false })
  hours?: string;

  @ApiProperty()
  locale: string;

  @ApiProperty({ type: [ResourceTaxonomyDto] })
  taxonomies: ResourceTranslation['taxonomies'];

  @ApiProperty()
  serviceName: string;

  @ApiProperty()
  serviceDescription: string;

  @ApiProperty()
  organizationDescription: string;

  @ApiProperty({ required: false })
  accessibility?: string;

  @ApiProperty({ required: false })
  transportation?: string;

  @ApiProperty({ type: [ResourceFacetDto], required: false })
  facets?: Facet[];

  @ApiProperty({
    required: false,
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  attributeValues?: Record<string, string>;

  @ApiProperty({ type: [ResourceContactDto] })
  contacts: ResourceTranslation['contacts'];

  @ApiProperty({ type: [LinkQualityUrlDto] })
  linkQualityUrls: ResourceTranslation['linkQualityUrls'];
}

export class TransformedResourceDto extends ResourceBaseDto {
  @ApiProperty({ type: ResourceTranslationDto })
  translation: ResourceTranslationDto;

  @ApiProperty({ type: [ResourceFacetDto] })
  facetsEn: Facet[];
}

export class ResourceTitleResponseDto extends PickType(ResourceBaseDto, [
  'displayName',
] as const) {
  @ApiProperty()
  id: string;
}
