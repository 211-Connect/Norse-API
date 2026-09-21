/**
 * The runtime shape of `GET /service/:id`.
 *
 * Deliberately loose below the named scalars, matching `OrganizationDetail`:
 * the nested HSDS sub-documents are `OBJECT_CONSTRUCT(obj.*)` over dbt views,
 * so their key sets are declared nowhere and may gain a column upstream.
 */
export interface ServiceDetail {
  serviceId: string;
  tenant_id: string;
  resourceWriterId?: string;
  organizationId?: string;
  originalId?: string;
  name?: string;
  alternateName?: string;
  description?: string;
  status?: string;
  organization?: Record<string, unknown> | null;
  locations?: Record<string, unknown>[];
  [key: string]: unknown;
}
