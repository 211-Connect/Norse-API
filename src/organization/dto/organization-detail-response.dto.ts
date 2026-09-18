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
  @ApiProperty({
    nullable: true,
    required: false,
    description:
      'Rank, not a score: **0 is the primary phone** and larger numbers are ' +
      'progressively less preferred. 0 is always a voice line; fax appears ' +
      'from 1 down. See docs/phone-and-address-rank.md — the equivalent field ' +
      'on addresses is 1-based, which has already caused one bug.',
  })
  PRIORITY?: number;
  @ApiProperty({ type: [TranslationDto] }) TRANSLATIONS: TranslationDto[];
}

class ContactDto {
  @ApiProperty() ID: string;
  @ApiProperty({ nullable: true }) NAME?: string;
  @ApiProperty({ nullable: true }) TITLE?: string;
  @ApiProperty({ nullable: true }) EMAIL?: string;
}

class ServiceAtLocationDisplayDto {
  @ApiProperty({ nullable: true, required: false }) PHONE_NUMBER?: string;

  @ApiProperty({
    type: [PhoneDto],
    required: false,
    description:
      'Merged from the organization, service, location and pairing, then ' +
      'ranked. A location phone joins this list rather than replacing the ' +
      "service's — there is no per-location override.",
  })
  PHONE_LIST?: PhoneDto[];

  @ApiProperty({ type: [ContactDto], required: false })
  CONTACT_LIST?: ContactDto[];
  @ApiProperty({ nullable: true, required: false }) WEBSITE?: string;
  @ApiProperty({ nullable: true, required: false }) EMAIL?: string;

  @ApiProperty({
    nullable: true,
    required: false,
    description:
      'The one winning schedule for this pairing; the candidates it beat are ' +
      'not represented here. English — see DISPLAY on the parent.',
  })
  SCHEDULE?: string;
}

class ServiceAtLocationDto {
  @ApiProperty({
    description:
      'The serviceAtLocationId. Keys the `resources` collection — pass it to ' +
      'POST /resource/batch for the full search-facing document.',
  })
  ID: string;

  // `required: false` on the genuinely optional fields below: @ApiProperty
  // defaults required to true, which would tell the generated SDK these are
  // always present. Older DTO classes in this file predate that care.
  @ApiProperty({ nullable: true, required: false }) LOCATION_ID?: string;
  @ApiProperty({ nullable: true, required: false }) ORIGINAL_ID?: string;
  @ApiProperty({ nullable: true, required: false }) ASSURED_DATE?: string;
  @ApiProperty({ nullable: true, required: false }) ASSURER_EMAIL?: string;

  @ApiProperty({
    type: [ScheduleDto],
    required: false,
    description:
      'Attached to the pairing itself, so they appear here and nowhere else ' +
      'in this document. Editable source rows, unlike DISPLAY.',
  })
  SCHEDULES?: ScheduleDto[];

  @ApiProperty({
    type: ServiceAtLocationDisplayDto,
    required: false,
    description:
      'What a seeker is shown for this service at this location. READ-ONLY: ' +
      'every value is derived from a phone, contact or schedule that also ' +
      'appears, with its own ID, elsewhere in this document — propose changes ' +
      'against that row, not against these values. May be absent, which is ' +
      'not an error. English throughout, like the rest of this document: ' +
      'SCHEDULE is a scalar and the TRANSLATIONS nested in PHONE_LIST and ' +
      'CONTACT_LIST are filtered to `en`. The search index reads the ' +
      'multi-locale form elsewhere.',
  })
  DISPLAY?: ServiceAtLocationDisplayDto;
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
  @ApiProperty({ type: [ServiceAtLocationDto] })
  SERVICE_AT_LOCATIONS: ServiceAtLocationDto[];

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
