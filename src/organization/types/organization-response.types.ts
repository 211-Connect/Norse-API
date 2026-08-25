/**
 * Types for the organization-detail response.
 * Derives from the Organization schema to avoid duplication.
 */

import { Organization } from 'src/common/schemas/organization.schema';

/**
 * A single translation from the Organization.translations array.
 */
export type OrganizationTranslation = Organization['translations'][number];

/**
 * The organization graph returned to clients. Mirrors the /resource transform:
 * the top-level `translations` array is collapsed to a single locale-resolved
 * `translation` (null when the org has no description in the requested locale
 * or English). Nested service/location/phone translations are left intact.
 *
 * To fetch the full service-at-location detail for an org, read the SAL ids
 * from `services[].SERVICE_AT_LOCATIONS[].ID` and call POST /resource/batch.
 */
export type OrganizationDetail = Omit<Organization, 'translations'> & {
  translation: OrganizationTranslation | null;
};
