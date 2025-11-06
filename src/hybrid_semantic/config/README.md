# Hybrid Semantic Configuration

This directory contains configuration files for the hybrid semantic search module.

## Table of Contents
- [Weights Configuration](#weights-configuration)
- [Tenant Mapping](#tenant-mapping)

---

## Weights Configuration

The `default-weights.json` file contains the default weight configuration for all search strategies. This file is designed to be easily updated by hyperparameter tuning pipelines.

### Overview

The weights configuration controls the relative importance of different search strategies and sub-strategies. The system uses a three-tier priority system:

1. **Request-level weights** (highest priority) - `custom_weights` in API request
2. **Legacy parameters** (backward compatibility) - Individual weight parameters
3. **Configuration file** (default) - `default-weights.json`

### Configuration Structure

```json
{
  "version": "1.0.0",
  "description": "Configuration description",
  "last_updated": "2025-01-04",
  "semantic": {
    "service": 1.0,
    "taxonomy": 1.0,
    "organization": 1.0
  },
  "strategies": {
    "semantic_search": 1.0,
    "keyword_search": 1.0,
    "intent_driven": 1.0
  },
  "geospatial": {
    "weight": 2.0,
    "decay_scale": 50,
    "decay_offset": 0
  },
  "keyword_variations": {
    "nouns_multiplier": 0.95,
    "stemmed_nouns_multiplier": 0.85
  },
  "metadata": {
    "tuning_notes": "Notes about this configuration",
    "evaluation_metrics": {
      "ndcg": null,
      "mrr": null,
      "precision_at_10": null
    }
  }
}
```

### Weight Parameters

#### Semantic Weights (0-10)
- **`semantic.service`** - Weight for service-level semantic search (default: 1.0)
- **`semantic.taxonomy`** - Weight for taxonomy-level semantic search (default: 1.0)
- **`semantic.organization`** - Weight for organization-level semantic search (default: 1.0)

These weights control the importance of different embedding fields in semantic search.

#### Strategy Weights (0-10)
- **`strategies.semantic_search`** - Overall semantic search multiplier (default: 1.0)
- **`strategies.keyword_search`** - Keyword/text search weight (default: 1.0)
- **`strategies.intent_driven`** - Intent-driven taxonomy search weight (default: 1.0)

Strategy weights are multiplied with semantic sub-weights. For example, the final weight for service-level semantic search is: `semantic.service * strategies.semantic_search`

#### Geospatial Weights
- **`geospatial.weight`** (0-10, default: 2.0) - Multiplier for proximity scoring
- **`geospatial.decay_scale`** (1-200 miles, default: 50) - Distance at which score decays to 50%
- **`geospatial.decay_offset`** (0-50 miles, default: 0) - Distance before decay starts

#### Keyword Variation Multipliers (0-10)
- **`keyword_variations.nouns_multiplier`** (default: 0.95) - Multiplier for nouns-only keyword search
- **`keyword_variations.stemmed_nouns_multiplier`** (default: 0.85) - Multiplier for stemmed nouns search

These multipliers are applied to the `strategies.keyword_search` weight. Values > 1.0 boost the variation above the original query weight, which can be valid if noun-focused queries perform better than full queries in your domain.

### Hot-Reloading

The configuration service watches `default-weights.json` for changes and automatically reloads every 5 seconds. This allows you to:

1. Update the configuration file
2. Wait up to 5 seconds
3. New requests will use the updated weights

**No server restart required!**

### Hyperparameter Tuning Workflow

1. **Run your tuning pipeline** - Test different weight combinations
2. **Evaluate metrics** - Measure NDCG, MRR, Precision@10, etc.
3. **Update configuration** - Write the best weights to `default-weights.json`
4. **Deploy** - Drop the file into the server (hot-reloads automatically)

Example tuning pipeline output:

```json
{
  "version": "1.1.0",
  "description": "Optimized for Illinois 211 dataset",
  "last_updated": "2025-01-05",
  "semantic": {
    "service": 1.8,
    "taxonomy": 1.2,
    "organization": 0.9
  },
  "strategies": {
    "semantic_search": 1.5,
    "keyword_search": 0.8,
    "intent_driven": 1.3
  },
  "geospatial": {
    "weight": 2.5,
    "decay_scale": 35,
    "decay_offset": 2
  },
  "keyword_variations": {
    "nouns_multiplier": 0.92,
    "stemmed_nouns_multiplier": 0.78
  },
  "metadata": {
    "tuning_notes": "Optimized using Bayesian optimization over 500 iterations",
    "evaluation_metrics": {
      "ndcg": 0.847,
      "mrr": 0.782,
      "precision_at_10": 0.91
    }
  }
}
```

### Validation

The configuration service validates all weights on load:
- Semantic/strategy weights must be 0-10
- Geospatial weight must be 0-10
- Decay scale must be 1-200
- Decay offset must be 0-50
- Keyword multipliers must be 0-10

Invalid configurations will fall back to hardcoded defaults and log an error.

### Schema Validation

The `weights-schema.json` file provides JSON Schema validation for IDE support and external validation tools.

---

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
