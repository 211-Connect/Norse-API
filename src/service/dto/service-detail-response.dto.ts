import { ApiProperty } from '@nestjs/swagger';

// OpenAPI shape for GET /service/:id (runtime type: ServiceDetail).
//
// NOT a runtime allow-list: nested HSDS sub-documents carry more keys than are
// typed here. The endpoint drops only `_id` and narrows translations.
//
// Service-level `translations` is absent because it never reaches the document,
// despite the dbt model's header listing it.

class TranslationDto {
  @ApiProperty({ nullable: true }) ID?: string;
  @ApiProperty({ nullable: true }) LOCALE?: string;
  @ApiProperty({ nullable: true }) IS_CANONICAL?: boolean;
}

class WithTranslationsDto {
  @ApiProperty({ nullable: true }) ID?: string;
  @ApiProperty({ type: [TranslationDto] }) TRANSLATIONS: TranslationDto[];
}

class PhoneDto {
  @ApiProperty({ nullable: true }) ID?: string;
  @ApiProperty({ nullable: true }) NUMBER?: string;
  @ApiProperty({ nullable: true }) EXTENSION?: string;
  @ApiProperty({ nullable: true }) TYPE?: string;
  @ApiProperty({ nullable: true }) PRIORITY?: number;
  @ApiProperty({ type: [TranslationDto] }) TRANSLATIONS: TranslationDto[];
}

class AddressDto {
  @ApiProperty({ nullable: true }) ID?: string;
  @ApiProperty({ nullable: true }) ATTENTION?: string;
  @ApiProperty({ nullable: true }) ADDRESS_1?: string;
  @ApiProperty({ nullable: true }) ADDRESS_2?: string;
  @ApiProperty({ nullable: true }) CITY?: string;
  @ApiProperty({ nullable: true }) REGION?: string;
  @ApiProperty({ nullable: true }) STATE_PROVINCE?: string;
  @ApiProperty({ nullable: true }) POSTAL_CODE?: string;
  @ApiProperty({ nullable: true }) COUNTRY?: string;
  @ApiProperty({ nullable: true }) ADDRESS_TYPE?: string;
}

class LocationDto {
  @ApiProperty({ nullable: true }) ID?: string;
  @ApiProperty({ nullable: true }) NAME?: string;
  @ApiProperty({ nullable: true }) ALTERNATE_NAME?: string;
  @ApiProperty({ nullable: true }) LOCATION_TYPE?: string;
  @ApiProperty({ nullable: true }) DESCRIPTION?: string;
  @ApiProperty({ nullable: true }) SHORT_DESCRIPTION?: string;
  @ApiProperty({ nullable: true }) TRANSPORTATION?: string;
  @ApiProperty({ nullable: true }) URL?: string;
  @ApiProperty({ nullable: true }) LATITUDE?: number;
  @ApiProperty({ nullable: true }) LONGITUDE?: number;
  @ApiProperty({ type: [AddressDto] }) ADDRESSES: AddressDto[];
  @ApiProperty({ type: [PhoneDto] }) PHONES: PhoneDto[];
  @ApiProperty({ type: [WithTranslationsDto] }) CONTACTS: WithTranslationsDto[];
  @ApiProperty({ type: [WithTranslationsDto] })
  LANGUAGES: WithTranslationsDto[];
  @ApiProperty({ type: [WithTranslationsDto] })
  ACCESSIBILITY: WithTranslationsDto[];
  @ApiProperty({ type: [WithTranslationsDto] })
  SCHEDULES: WithTranslationsDto[];
}

class OrganizationSummaryDto {
  @ApiProperty({ nullable: true }) ID?: string;
  @ApiProperty({ nullable: true }) NAME?: string;
  @ApiProperty({ nullable: true }) ALTERNATE_NAME?: string;
  @ApiProperty({ nullable: true }) DESCRIPTION?: string;
  @ApiProperty({ nullable: true }) EMAIL?: string;
  @ApiProperty({ nullable: true }) WEBSITE?: string;
  @ApiProperty({ nullable: true }) LEGAL_STATUS?: string;
  @ApiProperty({ nullable: true }) YEAR_INCORPORATED?: string;
  @ApiProperty({
    nullable: true,
    description:
      'Source-system provider key as found. Does NOT resolve to an Organization in this model.',
  })
  PARENT_ORGANIZATION_ID?: string;
  @ApiProperty({ type: [TranslationDto] }) TRANSLATIONS: TranslationDto[];
}

export class ServiceDetailResponseDto {
  @ApiProperty() serviceId: string;
  @ApiProperty() tenant_id: string;
  @ApiProperty({ nullable: true }) resourceWriterId?: string;
  @ApiProperty({
    nullable: true,
    description:
      'Tenant-scoped pointer ({tenant_id}:{ORGANIZATION_ID}), not an HSDS id. The HSDS id is organization.ID.',
  })
  organizationId?: string;
  @ApiProperty({ nullable: true }) originalId?: string;
  @ApiProperty({ nullable: true }) name?: string;
  @ApiProperty({ nullable: true }) alternateName?: string;
  @ApiProperty({ nullable: true }) description?: string;
  @ApiProperty({ nullable: true }) url?: string;
  @ApiProperty({ nullable: true }) email?: string;
  @ApiProperty({ nullable: true }) status?: string;
  @ApiProperty({ nullable: true }) applicationProcess?: string;
  @ApiProperty({ nullable: true }) eligibilityDescription?: string;
  @ApiProperty({ nullable: true }) interpretationServices?: string;
  @ApiProperty({ nullable: true }) minimumAge?: number;
  @ApiProperty({ nullable: true }) maximumAge?: number;
  @ApiProperty({ nullable: true }) assuredDate?: string;
  @ApiProperty({ nullable: true }) assurerEmail?: string;
  @ApiProperty({ nullable: true }) alert?: string;
  @ApiProperty({ nullable: true }) accreditations?: string;
  @ApiProperty({ nullable: true }) lastModified?: string;

  @ApiProperty({
    type: OrganizationSummaryDto,
    nullable: true,
    description:
      'The parent Organization. NULL for an orphan service; an empty object is never returned.',
  })
  organization?: OrganizationSummaryDto | null;

  @ApiProperty({
    type: [LocationDto],
    description:
      'Every Location this service is delivered at, de-duplicated by location id.',
  })
  locations: LocationDto[];

  @ApiProperty({ type: [PhoneDto] }) phones: PhoneDto[];
  @ApiProperty({ type: [WithTranslationsDto] }) contacts: WithTranslationsDto[];
  @ApiProperty({ type: [WithTranslationsDto] })
  schedules: WithTranslationsDto[];
  @ApiProperty({ type: [WithTranslationsDto] })
  languages: WithTranslationsDto[];
  @ApiProperty({ type: [WithTranslationsDto] })
  serviceAreas: WithTranslationsDto[];
  @ApiProperty({ type: [WithTranslationsDto] })
  costOptions: WithTranslationsDto[];
  @ApiProperty({ type: [WithTranslationsDto] }) funding: WithTranslationsDto[];
  @ApiProperty({ type: [WithTranslationsDto] })
  requiredDocuments: WithTranslationsDto[];
  @ApiProperty({ type: [WithTranslationsDto] })
  attributeTaxonomies: WithTranslationsDto[];

  @ApiProperty({
    type: [String],
    description: 'AIRS codes as coded, for display.',
  })
  taxonomyCodes: string[];

  @ApiProperty({
    type: [String],
    description:
      'Ancestor-expanded AIRS codes — the matching key, not coded content.',
  })
  taxonomyPath: string[];
}
