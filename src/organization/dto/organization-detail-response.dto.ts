import { ApiProperty } from '@nestjs/swagger';

// OpenAPI shape for GET /organization/:id (runtime type: OrganizationDetail).
// Documents the fields the provider-feedback consumer relies on; it is NOT a
// runtime allow-list, so nested HSDS sub-documents carry more keys than typed
// here (the service drops only `_id`/`logo` and locale-filters translations).
// All `translations`/`TRANSLATIONS` stay ARRAYS filtered to the requested locale
// (preferred -> English -> canonical); the consumer makes the final selection.

class TranslationDto {
  @ApiProperty({ nullable: true }) ID?: string;
  @ApiProperty({ nullable: true }) LOCALE?: string;
  @ApiProperty({ nullable: true }) DESCRIPTION?: string | null;
  @ApiProperty({ nullable: true }) IS_CANONICAL?: boolean;
}

class ScheduleDto {
  @ApiProperty() ID: string;
  @ApiProperty({ nullable: true }) FREQ?: string;
  @ApiProperty({ nullable: true }) INTERVAL?: number;
  @ApiProperty({ nullable: true }) BYDAY?: string;
  @ApiProperty({ nullable: true }) OPENS_AT?: string;
  @ApiProperty({ nullable: true }) CLOSES_AT?: string;
  @ApiProperty({ type: [TranslationDto] }) TRANSLATIONS: TranslationDto[];
}

class IdWithTranslationsDto {
  @ApiProperty() ID: string;
  @ApiProperty({ type: [TranslationDto] }) TRANSLATIONS: TranslationDto[];
}

class ServiceAreaDto {
  @ApiProperty() ID: string;
  @ApiProperty({ nullable: true }) NAME?: string;
  @ApiProperty({ nullable: true }) X_SOURCE_EXTENT?: string;
  @ApiProperty({ type: [TranslationDto] }) TRANSLATIONS: TranslationDto[];
}

class AddressDto {
  @ApiProperty() ID: string;
  @ApiProperty({ nullable: true }) ADDRESS_1?: string;
  @ApiProperty({ nullable: true }) CITY?: string;
  @ApiProperty({ nullable: true }) REGION?: string;
  @ApiProperty({ nullable: true }) STATE_PROVINCE?: string;
  @ApiProperty({ nullable: true }) POSTAL_CODE?: string;
  @ApiProperty({ nullable: true }) ADDRESS_TYPE?: string;
}

class PhoneDto {
  @ApiProperty() ID: string;
  @ApiProperty({ nullable: true }) NUMBER?: string;
  @ApiProperty({ nullable: true }) TYPE?: string;
  @ApiProperty({ type: [TranslationDto] }) TRANSLATIONS: TranslationDto[];
}

class ContactDto {
  @ApiProperty() ID: string;
  @ApiProperty({ nullable: true }) NAME?: string;
  @ApiProperty({ nullable: true }) TITLE?: string;
  @ApiProperty({ nullable: true }) EMAIL?: string;
}

class ServiceDto {
  @ApiProperty() ID: string;
  @ApiProperty({ nullable: true }) NAME?: string;
  @ApiProperty({ nullable: true }) ALTERNATE_NAME?: string;
  @ApiProperty({ nullable: true }) DESCRIPTION?: string;
  @ApiProperty({ nullable: true }) STATUS?: string;
  @ApiProperty({ nullable: true }) ELIGIBILITY_DESCRIPTION?: string;
  @ApiProperty({ nullable: true }) APPLICATION_PROCESS?: string;
  @ApiProperty({ type: [ScheduleDto] }) SCHEDULES: ScheduleDto[];
  @ApiProperty({ type: [IdWithTranslationsDto] })
  REQUIRED_DOCUMENTS: IdWithTranslationsDto[];
  @ApiProperty({ type: [IdWithTranslationsDto] })
  LANGUAGES: IdWithTranslationsDto[];
  @ApiProperty({ type: [ServiceAreaDto] }) SERVICE_AREAS: ServiceAreaDto[];
  @ApiProperty({ type: [ContactDto] }) CONTACTS: ContactDto[];
  @ApiProperty({ type: [PhoneDto] }) PHONES: PhoneDto[];
  @ApiProperty({ nullable: true }) ASSURED_DATE?: string;
  @ApiProperty({ nullable: true }) LAST_MODIFIED?: string;
  @ApiProperty({ type: 'array', items: { type: 'object' } })
  SERVICE_AT_LOCATIONS: Record<string, unknown>[];

  // Kept per product direction (unused by provider-feedback today).
  @ApiProperty({ type: 'array', items: { type: 'object' }, required: false })
  ATTRIBUTE_TAXONOMIES?: Record<string, unknown>[];
  @ApiProperty({ type: 'array', items: { type: 'object' }, required: false })
  CUSTOM_ATTRIBUTES?: Record<string, unknown>[];
  @ApiProperty({ type: 'array', items: { type: 'object' }, required: false })
  COST_OPTIONS?: Record<string, unknown>[];
  @ApiProperty({ type: 'array', items: { type: 'object' }, required: false })
  FUNDING?: Record<string, unknown>[];
}

class LocationDto {
  @ApiProperty() ID: string;
  @ApiProperty({ nullable: true }) NAME?: string;
  @ApiProperty({ nullable: true }) ALTERNATE_NAME?: string;
  @ApiProperty({ nullable: true }) LOCATION_TYPE?: string;
  @ApiProperty({ type: [AddressDto] }) ADDRESSES: AddressDto[];
  @ApiProperty({ type: [ScheduleDto] }) SCHEDULES: ScheduleDto[];
  @ApiProperty({ type: [IdWithTranslationsDto] })
  LANGUAGES: IdWithTranslationsDto[];
  @ApiProperty({ type: [PhoneDto] }) PHONES: PhoneDto[];
  @ApiProperty({ type: [ContactDto] }) CONTACTS: ContactDto[];
}

export class OrganizationDetailResponseDto {
  // Absent in some legacy orgs; feedback anchors on this when present.
  @ApiProperty({ nullable: true }) organizationId: string | null;
  @ApiProperty({ nullable: true }) resourceWriterId?: string;
  @ApiProperty() tenant_id: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true }) alternateName?: string;
  @ApiProperty({ nullable: true }) email?: string;
  @ApiProperty({ nullable: true }) website?: string;
  @ApiProperty({ nullable: true }) taxStatus?: string;
  @ApiProperty({ nullable: true }) tax_status?: string;
  @ApiProperty({ nullable: true }) legalStatus?: string;
  @ApiProperty({ nullable: true }) parentOrganizationId?: string;

  @ApiProperty({ type: [TranslationDto] })
  translations: TranslationDto[];

  @ApiProperty({ type: [PhoneDto] }) phones: PhoneDto[];
  @ApiProperty({ type: [ContactDto] }) contacts: ContactDto[];
  @ApiProperty({ type: [LocationDto] }) locations: LocationDto[];

  @ApiProperty({
    type: [ServiceDto],
    description:
      'HSDS services. Use SERVICE_AT_LOCATIONS[].ID with POST /resource/batch for service-at-location detail.',
  })
  services: ServiceDto[];

  @ApiProperty({ type: 'array', items: { type: 'object' }, required: false })
  programs?: Record<string, unknown>[];
  @ApiProperty({ type: 'array', items: { type: 'object' }, required: false })
  funding?: Record<string, unknown>[];
  @ApiProperty({ type: 'array', items: { type: 'object' }, required: false })
  organizationIdentifiers?: Record<string, unknown>[];
}
