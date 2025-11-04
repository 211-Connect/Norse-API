/**
 * Tenant Mapping Configuration
 *
 * Maps tenant names (as returned from Strapi) to their corresponding short codes
 * used in OpenSearch index naming conventions.
 *
 * Format: {tenant-short-code}-resources_{locale}
 *
 * Example:
 * - Tenant Name: "Illinois 211"
 * - Short Code: "il211"
 * - Index: "il211-resources_en"
 */

export interface TenantMapping {
  /** Full tenant name as returned from Strapi */
  name: string;
  /** Short code used in OpenSearch index naming */
  shortCode: string;
  /** Optional description for documentation */
  description?: string;
}

/**
 * Tenant mappings dictionary
 * Add new tenants here as they are onboarded
 */
export const TENANT_MAPPINGS: Record<string, TenantMapping> = {
  'Illinois 211': {
    name: 'Illinois 211',
    shortCode: 'il211',
    description: 'Illinois 211 - Statewide information and referral service',
  },
  // Add additional tenant mappings below:
  // 'California 211': {
  //   name: 'California 211',
  //   shortCode: 'ca211',
  //   description: 'California 211 - Statewide information and referral service',
  // },
};

/**
 * Get the short code for a given tenant name
 * @param tenantName - The full tenant name from Strapi
 * @returns The short code for the tenant, or the original name if no mapping exists
 * @throws Error if tenant name is not found and strict mode is enabled
 */
export function getTenantShortCode(
  tenantName: string,
  strict: boolean = false,
): string {
  const mapping = TENANT_MAPPINGS[tenantName];

  if (!mapping) {
    if (strict) {
      throw new Error(
        `Tenant mapping not found for: "${tenantName}". ` +
          `Available tenants: ${Object.keys(TENANT_MAPPINGS).join(', ')}`,
      );
    }
    // Fallback: return the original name if no mapping exists
    return tenantName;
  }

  return mapping.shortCode;
}

/**
 * Get all available tenant names
 * @returns Array of all configured tenant names
 */
export function getAvailableTenants(): string[] {
  return Object.keys(TENANT_MAPPINGS);
}

/**
 * Check if a tenant mapping exists
 * @param tenantName - The full tenant name to check
 * @returns True if mapping exists, false otherwise
 */
export function hasTenantMapping(tenantName: string): boolean {
  return tenantName in TENANT_MAPPINGS;
}
