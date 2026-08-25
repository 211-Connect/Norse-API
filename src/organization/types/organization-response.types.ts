/**
 * Types for the organization-detail response.
 * Derives from the Organization schema to avoid duplication.
 */

import { Organization } from 'src/common/schemas/organization.schema';
import {
  ResourceBatchError,
  TransformedResourceMap,
} from 'src/resource/types/resource-response.types';

/**
 * A single translation from the Organization.translations array.
 */
export type OrganizationTranslation = Organization['translations'][number];

/**
 * The organization graph returned to clients. Mirrors the /resource transform:
 * the top-level `translations` array is collapsed to a single locale-resolved
 * `translation` (null when the org has no description in the requested locale
 * or English). Nested service/location/phone translations are left intact.
 */
export type OrganizationDetail = Omit<Organization, 'translations'> & {
  translation: OrganizationTranslation | null;
};

/**
 * Sideloaded related entities (JSON:API `include` pattern). Resources are keyed
 * by their serviceAtLocationId, matching the /resource/batch `data` map.
 */
export interface OrganizationIncluded {
  resources: TransformedResourceMap;
}

/**
 * Metadata describing the outcome of each requested `include`.
 */
export interface OrganizationIncludeMeta {
  resources?: {
    requested: number;
    successful: number;
    failed: number;
    errors: ResourceBatchError[];
  };
}

/**
 * The full organization-detail response envelope. `included`/`meta` are only
 * present when the corresponding `?include=` value was requested.
 */
export interface OrganizationDetailResponse {
  data: OrganizationDetail;
  included?: OrganizationIncluded;
  meta?: OrganizationIncludeMeta;
}
