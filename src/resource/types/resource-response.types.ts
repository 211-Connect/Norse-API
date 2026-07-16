/**
 * Types for transformed resource responses
 * Derives from Resource schema to avoid duplication
 */

import {
  Resource,
  Taxonomy,
  Facet,
  PhoneNumber,
  Contact,
} from 'src/common/schemas/resource.schema';

/**
 * A single translation from the Resource.translations array.
 * Extracts the type from the array element.
 */
export type ResourceTranslation = Resource['translations'][number];

/**
 * Re-export schema types for convenience
 */
export type { Taxonomy, Facet, PhoneNumber, Contact };

/**
 * The transformed resource response returned to clients.
 * Omits the translations array and adds single translation + facetsEn fields.
 */
export type TransformedResource = Omit<Resource, 'translations'> & {
  translation: ResourceTranslation;
  facetsEn: Facet[];
};

export type TransformedResourceMap = Record<string, TransformedResource>;

export interface ResourceBatchError {
  id: string;
  reason: string;
  statusCode: number;
}

export interface ResourceBatchMeta {
  requested: number;
  successful: number;
  failed: number;
}

export interface ResourceBatchResponse {
  data: TransformedResourceMap;
  errors: ResourceBatchError[];
  meta: ResourceBatchMeta;
}
