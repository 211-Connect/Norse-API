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

class DisplayScheduleTranslationDto {
  @ApiProperty({ nullable: true, required: false }) LOCALE?: string;
  @ApiProperty({
    nullable: true,
    required: false,
    description:
      'The one schedule a seeker is shown for this pairing, in this locale. ' +
      'Already narrowed from every candidate schedule by the tenant rules — ' +
      'not a list to choose from.',
  })
  DISPLAY_SCHEDULE?: string;
}

class ServiceAtLocationDisplayDto {
  @ApiProperty({
    nullable: true,
    required: false,
    description: 'Primary number for this pairing — rank 0 of PHONE_LIST.',
  })
  PHONE_NUMBER?: string;

  @ApiProperty({
    type: [PhoneDto],
    description:
      'Every phone in scope for this pairing — the organization, service, ' +
      'location and service-at-location phones merged, then ordered by the ' +
      "tenant's own ranking rules. PRIORITY 0 is what the seeker sees first. " +
      'Merged, not substituted: a location phone does not replace the ' +
      "service's, it joins the list ahead of or behind it.",
  })
  PHONE_LIST: PhoneDto[];

  @ApiProperty({ type: [ContactDto] }) CONTACT_LIST: ContactDto[];
  @ApiProperty({ nullable: true, required: false }) WEBSITE?: string;
  @ApiProperty({ nullable: true, required: false }) EMAIL?: string;

  @ApiProperty({
    type: [DisplayScheduleTranslationDto],
    description:
      'The resolved schedule for this pairing, one entry per locale. Unlike ' +
      'PHONE_LIST this really is a substitution: the tenant rules pick a ' +
      "single winning schedule — the service's where it has one, otherwise " +
      "the location's — and only the winner appears here.",
  })
  TRANSLATIONS: DisplayScheduleTranslationDto[];
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
    description:
      'Schedules attached to this pairing rather than to the service or the ' +
      'location. HSDS lets a schedule hang off a service_at_location, and such ' +
      'a row carries neither a service_id nor a location_id — so it appears ' +
      'here and nowhere else in this document. Source rows with their own IDs: ' +
      'editable, unlike DISPLAY.',
  })
  SCHEDULES: ScheduleDto[];

  @ApiProperty({
    type: ServiceAtLocationDisplayDto,
    required: false,
    description:
      'What a seeker is actually shown for this service at this location, ' +
      'resolved through the same tenant rules the search index uses — so it ' +
      'matches the public site rather than this document. ' +
      'READ-ONLY: every value here is derived from a phone, contact or ' +
      'schedule that also appears, with its own ID, under the service, the ' +
      'location, or the top-level phones/contacts arrays. To propose a change, ' +
      'target that underlying row by its ID; a value here has no record behind ' +
      'it to write to. Absent when the tenant produced no display row for the ' +
      'pairing, which is not an error — the pairing is still real.',
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
  @ApiProperty({
    type: [ServiceAtLocationDto],
    description:
      'One entry per location this service is offered at. Carries the link, ' +
      'any schedules attached to the pairing itself, and DISPLAY — the ' +
      'resolved, read-only view a seeker sees for this service at that ' +
      'location. Where a service is offered at several locations, the phone ' +
      'list and the schedule are what differ between them in practice; ' +
      'name and description do not.',
  })
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
      'HSDS services. Each service carries SERVICE_AT_LOCATIONS[], which now ' +
      'includes the resolved per-location DISPLAY view inline — a second call ' +
      'is no longer needed just to see what a seeker is shown. Use ' +
      'SERVICE_AT_LOCATIONS[].ID with POST /resource/batch when you need the ' +
      'full search document for a pairing (taxonomy, attributes, geo).',
  })
  services: ServiceDto[];

  @ApiProperty({ type: 'array', items: { type: 'object' }, required: false })
  programs?: Record<string, unknown>[];
  @ApiProperty({ type: 'array', items: { type: 'object' }, required: false })
  funding?: Record<string, unknown>[];
  @ApiProperty({ type: 'array', items: { type: 'object' }, required: false })
  organizationIdentifiers?: Record<string, unknown>[];
}
