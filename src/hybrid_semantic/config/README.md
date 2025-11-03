# Hybrid Semantic Configuration

This directory contains configuration files for the hybrid semantic search module.

## Tenant Mapping

The `tenant-mapping.config.ts` file provides a centralized mapping between tenant names (as returned from Strapi) and their corresponding short codes used in OpenSearch index naming.

### Usage

```typescript
import { getTenantShortCode, hasTenantMapping } from './config/tenant-mapping.config';

// Get short code for a tenant
const shortCode = getTenantShortCode('Illinois 211'); // Returns: 'il211'

// Check if mapping exists
if (hasTenantMapping('Illinois 211')) {
  // Mapping exists
}
```

### Adding New Tenants

To add a new tenant mapping:

1. Open `tenant-mapping.config.ts`
2. Add a new entry to the `TENANT_MAPPINGS` object:

```typescript
export const TENANT_MAPPINGS: Record<string, TenantMapping> = {
  'Illinois 211': {
    name: 'Illinois 211',
    shortCode: 'il211',
    description: 'Illinois 211 - Statewide information and referral service',
  },
  'California 211': {
    name: 'California 211',
    shortCode: 'ca211',
    description: 'California 211 - Statewide information and referral service',
  },
  // Add more tenants here...
};
```

### Index Naming Convention

The tenant short code is used to construct OpenSearch index names:

**Format:** `{tenant-short-code}-resources_{locale}`

**Examples:**
- `il211-resources_en` (Illinois 211, English)
- `il211-resources_es` (Illinois 211, Spanish)
- `ca211-resources_en` (California 211, English)

### Error Handling

By default, `getTenantShortCode()` returns the original tenant name if no mapping is found. To enforce strict validation:

```typescript
// Throws error if mapping not found
const shortCode = getTenantShortCode('Unknown Tenant', true);
```
