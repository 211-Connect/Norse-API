import { Organization } from 'src/common/schemas/organization.schema';

export type OrganizationTranslation = Organization['translations'][number];

// Org graph for GET /organization/:id. Internal `_id` and `logo` are dropped;
// `translations` (and every nested `TRANSLATIONS`) are filtered to the requested
// locale but kept as ARRAYS — the provider-feedback consumer does its own
// selection. For service-at-location detail, resolve the SAL ids at
// services[].SERVICE_AT_LOCATIONS[].ID via POST /resource/batch.
export type OrganizationDetail = Omit<Organization, '_id' | 'logo'>;
