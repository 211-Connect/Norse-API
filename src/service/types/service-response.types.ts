// Loose below the named scalars, matching `OrganizationDetail`: nested key sets
// come from `OBJECT_CONSTRUCT(obj.*)` over dbt views and are declared nowhere.
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
