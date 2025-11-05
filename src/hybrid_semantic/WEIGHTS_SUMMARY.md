# Weights Configuration Summary

## Overview

All configurable weights for the hybrid semantic search have been centralized into a JSON configuration file that supports hot-reloading and hyperparameter tuning pipelines.

## File Locations

```
src/hybrid_semantic/
├── config/
│   ├── default-weights.json          # ⭐ Main configuration file
│   ├── weights-schema.json           # JSON Schema for validation
│   ├── weights-config.service.ts     # Configuration loader service
│   ├── README.md                     # Configuration documentation
│   └── HYPERPARAMETER_TUNING.md      # Tuning guide
├── services/
│   └── opensearch.service.ts         # Uses WeightsConfigService
└── hybrid-semantic.service.ts        # Uses WeightsConfigService
```

## All Configurable Weights (11 Parameters)

### 1. Semantic Sub-Weights (3 parameters)
Located in: `default-weights.json` → `semantic`

| Parameter | Range | Default | Location in Code |
|-----------|-------|---------|------------------|
| `service` | 0-10 | 1.0 | `opensearch.service.ts:266-268` |
| `taxonomy` | 0-10 | 1.0 | `opensearch.service.ts:337-340` |
| `organization` | 0-10 | 1.0 | `opensearch.service.ts:409-412` |

**Effect:** Controls importance of different embedding fields in semantic search.

**Final weight calculation:**
```typescript
service_final = semantic.service * strategies.semantic_search
taxonomy_final = semantic.taxonomy * strategies.semantic_search
organization_final = semantic.organization * strategies.semantic_search
```

### 2. Strategy Weights (3 parameters)
Located in: `default-weights.json` → `strategies`

| Parameter | Range | Default | Location in Code |
|-----------|-------|---------|------------------|
| `semantic_search` | 0-10 | 1.0 | `opensearch.service.ts:266-268` (multiplier) |
| `keyword_search` | 0-10 | 1.0 | `opensearch.service.ts:553-554` |
| `intent_driven` | 0-10 | 1.0 | `opensearch.service.ts:640-641` |

**Effect:** Controls balance between different search approaches (semantic vs keyword vs intent).

### 3. Geospatial Weights (3 parameters)
Located in: `default-weights.json` → `geospatial`

| Parameter | Range | Default | Location in Code |
|-----------|-------|---------|------------------|
| `weight` | 0-10 | 2.0 | `opensearch.service.ts:797-803` |
| `decay_scale` | 1-200 miles | 50 | `opensearch.service.ts:798` |
| `decay_offset` | 0-50 miles | 0 | `opensearch.service.ts:799` |

**Effect:** Controls how distance affects ranking within filtered area.

**Decay function:** Gaussian decay
- At `decay_offset` miles: 100% score
- At `decay_scale` miles: 50% score
- Multiplied by `weight`

### 4. Keyword Variation Multipliers (2 parameters)
Located in: `default-weights.json` → `keyword_variations`

| Parameter | Range | Default | Location in Code |
|-----------|-------|---------|------------------|
| `nouns_multiplier` | 0-1 | 0.95 | `opensearch.service.ts:562-563` |
| `stemmed_nouns_multiplier` | 0-1 | 0.85 | `opensearch.service.ts:564-565` |

**Effect:** Applied to `keyword_search` weight for different query variations.

**Final weight calculation:**
```typescript
original_weight = strategies.keyword_search
nouns_weight = strategies.keyword_search * keyword_variations.nouns_multiplier
stemmed_weight = strategies.keyword_search * keyword_variations.stemmed_nouns_multiplier
```

## Weight Priority System

The system uses a three-tier priority for determining weights:

```
1. Request-level custom_weights (highest priority)
   ↓
2. Legacy request parameters (backward compatibility)
   ↓
3. Configuration file (default-weights.json)
```

**Implementation:**
- `opensearch.service.ts:746-791` - `getWeights()` method
- `hybrid-semantic.service.ts:379-423` - `extractWeights()` method

## Configuration Service

**File:** `config/weights-config.service.ts`

**Features:**
- ✅ Loads configuration from JSON file
- ✅ Validates all weight ranges
- ✅ Hot-reloads on file changes (5-second interval)
- ✅ Falls back to hardcoded defaults on error
- ✅ Provides typed access to all weights

**Usage:**
```typescript
constructor(
  private readonly weightsConfigService: WeightsConfigService,
) {}

// Get all weights
const config = this.weightsConfigService.getConfig();

// Get specific weight categories
const semantic = this.weightsConfigService.getSemanticWeights();
const strategies = this.weightsConfigService.getStrategyWeights();
const geospatial = this.weightsConfigService.getGeospatialWeights();
const keywordMults = this.weightsConfigService.getKeywordVariationMultipliers();
```

## Hyperparameter Tuning Workflow

### Step 1: Prepare Evaluation Dataset
Create a JSON file with queries and ground truth:
```json
{
  "queries": [
    {
      "query": "food pantry near me",
      "lat": 41.8781,
      "lon": -87.6298,
      "relevant_results": [
        {"id": "resource-123", "relevance": 3}
      ]
    }
  ]
}
```

### Step 2: Run Tuning Pipeline
```python
import optuna
import json
import time

def objective(trial):
    # Sample weights
    config = {
        "version": "1.0.0",
        "semantic": {
            "service": trial.suggest_float("sem_service", 0.1, 3.0),
            "taxonomy": trial.suggest_float("sem_taxonomy", 0.1, 3.0),
            "organization": trial.suggest_float("sem_org", 0.1, 3.0)
        },
        # ... other weights
    }
    
    # Write to file
    with open('default-weights.json', 'w') as f:
        json.dump(config, f, indent=2)
    
    # Wait for hot-reload
    time.sleep(6)
    
    # Evaluate and return metric
    return evaluate_ndcg(config)

study = optuna.create_study(direction='maximize')
study.optimize(objective, n_trials=100)
```

### Step 3: Deploy Optimized Weights
```bash
# Copy optimized config to production
cp optimized-weights.json src/hybrid_semantic/config/default-weights.json

# Verify hot-reload (check logs)
# Configuration automatically reloads within 5 seconds
```

## Testing Weights

### Test via Configuration File
```bash
# Edit default-weights.json
vim src/hybrid_semantic/config/default-weights.json

# Wait 5 seconds for hot-reload

# Test search
curl -X POST http://localhost:3000/api/v1/hybrid-semantic/search \
  -H "Content-Type: application/json" \
  -d '{"q": "food assistance", "limit": 10}'
```

### Test via Request Override
```bash
# Test without modifying config file
curl -X POST http://localhost:3000/api/v1/hybrid-semantic/search \
  -H "Content-Type: application/json" \
  -d '{
    "q": "food assistance",
    "custom_weights": {
      "semantic": {
        "service": 2.0,
        "taxonomy": 1.5
      },
      "strategies": {
        "keyword_search": 0.8
      }
    }
  }'
```

## Validation

The configuration service validates all weights on load:

```typescript
// Semantic/strategy weights: 0-10
validateWeight(value, name, 0, 10);

// Geospatial weight: 0-10
validateWeight(config.geospatial.weight, 'geospatial.weight', 0, 10);

// Decay scale: 1-200 miles
validateWeight(config.geospatial.decay_scale, 'geospatial.decay_scale', 1, 200);

// Decay offset: 0-50 miles
validateWeight(config.geospatial.decay_offset, 'geospatial.decay_offset', 0, 50);

// Keyword multipliers: 0-1
validateWeight(config.keyword_variations.nouns_multiplier, 'keyword_variations.nouns_multiplier', 0, 1);
```

Invalid configurations fall back to hardcoded defaults and log errors.

## Example Configurations

### Baseline (Default)
```json
{
  "version": "1.0.0",
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
  }
}
```

### Semantic-Heavy
```json
{
  "version": "1.1.0",
  "description": "Prioritize semantic understanding over exact matches",
  "semantic": {
    "service": 2.0,
    "taxonomy": 1.5,
    "organization": 1.0
  },
  "strategies": {
    "semantic_search": 1.8,
    "keyword_search": 0.6,
    "intent_driven": 1.2
  },
  "geospatial": {
    "weight": 2.0,
    "decay_scale": 50,
    "decay_offset": 0
  },
  "keyword_variations": {
    "nouns_multiplier": 0.95,
    "stemmed_nouns_multiplier": 0.85
  }
}
```

### Keyword-Heavy
```json
{
  "version": "1.2.0",
  "description": "Prioritize exact text matches",
  "semantic": {
    "service": 0.8,
    "taxonomy": 0.8,
    "organization": 0.8
  },
  "strategies": {
    "semantic_search": 0.7,
    "keyword_search": 2.0,
    "intent_driven": 1.0
  },
  "geospatial": {
    "weight": 2.0,
    "decay_scale": 50,
    "decay_offset": 0
  },
  "keyword_variations": {
    "nouns_multiplier": 0.98,
    "stemmed_nouns_multiplier": 0.90
  }
}
```

### Location-Aware
```json
{
  "version": "1.3.0",
  "description": "Strong proximity bias for local searches",
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
    "weight": 4.0,
    "decay_scale": 25,
    "decay_offset": 2
  },
  "keyword_variations": {
    "nouns_multiplier": 0.95,
    "stemmed_nouns_multiplier": 0.85
  }
}
```

## Monitoring

### Check Current Configuration
```bash
# View current config
cat src/hybrid_semantic/config/default-weights.json

# Check version
jq '.version' src/hybrid_semantic/config/default-weights.json
```

### Check Logs
```bash
# Configuration load messages
grep "Loaded weights configuration" logs/app.log

# Configuration reload messages
grep "Configuration file changed" logs/app.log

# Validation errors
grep "Failed to load weights configuration" logs/app.log
```

### Verify Weights in Response
The API response includes `sources_of_top_hits` showing which strategies contributed to each result and their weights:

```json
{
  "metadata": {
    "sources_of_top_hits": [
      {
        "id": "resource-123",
        "rank": 1,
        "total_document_relevance_score": 2.45,
        "sources": [
          {
            "strategy": "semantic_service",
            "pre_weight_score": 0.8234,
            "strategy_weight": 1.0
          },
          {
            "strategy": "keyword_original",
            "pre_weight_score": 0.6543,
            "strategy_weight": 1.0
          }
        ]
      }
    ]
  }
}
```

## Migration Notes

### Before
Weights were hardcoded in two places:
- `opensearch.service.ts:743-782` - Hardcoded defaults (1.0, 2.0, etc.)
- `opensearch.service.ts:557-559` - Hardcoded multipliers (0.95, 0.85)

### After
Weights are centralized:
- `config/default-weights.json` - Single source of truth
- `config/weights-config.service.ts` - Loader with validation
- Both services use `WeightsConfigService` for defaults

### Backward Compatibility
✅ Maintained - Legacy request parameters still work:
- `semantic_weight`
- `taxonomy_weight`
- `attribute_weight`
- `geospatial_weight`
- `distance_decay_scale`
- `distance_decay_offset`

## Quick Reference

| Task | Command |
|------|---------|
| View current config | `cat src/hybrid_semantic/config/default-weights.json` |
| Validate JSON | `jq . src/hybrid_semantic/config/default-weights.json` |
| Update config | Edit `default-weights.json` and wait 5 seconds |
| Test weights | Use `custom_weights` in API request |
| Check logs | `grep "weights configuration" logs/app.log` |
| Reset to defaults | Copy from `weights-schema.json` examples |

## Documentation

- **Configuration Guide:** `config/README.md`
- **Tuning Guide:** `config/HYPERPARAMETER_TUNING.md`
- **This Summary:** `WEIGHTS_SUMMARY.md`
- **API Documentation:** `README.md` (main module)
