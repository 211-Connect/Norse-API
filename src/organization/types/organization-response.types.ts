import { Organization } from 'src/common/schemas/organization.schema';

export type OrganizationTranslation = Organization['translations'][number];

// Org graph with `translations` collapsed to a single locale-resolved
// `translation`. For service-at-location detail, resolve the SAL ids at
// services[].SERVICE_AT_LOCATIONS[].ID via POST /resource/batch.
export type OrganizationDetail = Omit<Organization, 'translations'> & {
  translation: OrganizationTranslation | null;
};
