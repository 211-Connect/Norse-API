# Hybrid Semantic Search Module

## Overview

This module implements an advanced hybrid semantic search system that combines:

- **Semantic search** using vector embeddings (KNN) across service, taxonomy, and organization fields
- **Keyword search** with focused query variations (original query + POS-tagged nouns + stemmed nouns)
- **Intent-driven taxonomy queries** based on AI classification
- **Geospatial proximity scoring** with Gaussian decay functions
- **AI-powered reranking** via the ai-utils microservice
- **Customizable weights** for fine-tuning all search components

## Architecture

### Search Pipeline

The search process follows a 4-phase pipeline:

```
┌─────────────────────────────────────────────────────────────┐
│ PHASE 1: Query Embedding & Classification (Parallel)       │
│ ┌──────────────────┐    ┌──────────────────┐              │
│ │ Embed Query      │    │ Classify Intent  │              │
│ │ (ai-utils)       │    │ (ai-utils)       │              │
│ └──────────────────┘    └──────────────────┘              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ PHASE 2: Multi-Strategy OpenSearch Query (_msearch)        │
│ ┌─────────────────┐ ┌─────────────────┐ ┌──────────────┐  │
│ │ Service         │ │ Taxonomy        │ │ Organization │  │
│ │ Semantic        │ │ Semantic        │ │ Semantic     │  │
│ │ (KNN)           │ │ (KNN)           │ │ (KNN)        │  │
│ └─────────────────┘ └─────────────────┘ └──────────────┘  │
│ ┌─────────────────┐ ┌─────────────────┐ ┌──────────────┐  │
│ │ Keyword         │ │ Keyword         │ │ Keyword      │  │
│ │ Original        │ │ Nouns (POS)     │ │ Nouns Stem   │  │
│ └─────────────────┘ └─────────────────┘ └──────────────┘  │
│ ┌─────────────────┐                                        │
│ │ Intent-Driven   │                                        │
│ │ Taxonomy        │                                        │
│ └─────────────────┘                                        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ PHASE 3: AI-Powered Reranking                              │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ Rerank top N candidates using ai-utils               │   │
│ │ Returns optimal ordering for top 10 results          │   │
│ └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ PHASE 4: Post-Processing & Response Preparation            │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ - Remove embeddings from response                    │   │
│ │ - Remove service area (if requested)                 │   │
│ │ - Apply transformations                              │   │
│ └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Module Structure

```
hybrid_semantic/
├── dto/
│   ├── search-request.dto.ts      # Request validation schema with custom weights
│   └── search-response.dto.ts     # Response types with granular timings
├── services/
│   └── opensearch.service.ts      # OpenSearch query builder with NLP preprocessing
├── hybrid-semantic.controller.ts  # HTTP endpoint with comprehensive Swagger docs
├── hybrid-semantic.service.ts     # Main orchestration logic (4-phase pipeline)
├── hybrid-semantic.module.ts      # NestJS module
└── README.md                      # This file

Note: AI-utils integration is in src/common/services/ai-utils.service.ts
Note: Tenant mapping is in src/common/config/tenant-mapping.config.ts
```

## Tenant Configuration

The module uses a centralized tenant mapping system to convert tenant names (from Strapi) to short codes used in OpenSearch indices.

**Configuration file**: `config/tenant-mapping.config.ts`

**Example mapping**:

- Tenant Name: `Illinois 211` → Short Code: `il211`
- Index: `il211-resources_en`

To add new tenants, see `config/README.md` for detailed instructions.

## OpenSearch Index Structure

Documents are stored in tenant-specific indices:

- **Index naming**: `{tenant-short-code}-resources_{locale}`
- **Example**: `il211-resources_en`, `il211-resources_es`

### Key Fields with Embeddings

The following nested fields contain KNN vector embeddings:

- `service.embedding` - Service-level semantic search
- `organization.embedding` - Organization-level semantic search
- `taxonomies[].embedding` - Taxonomy-level semantic search

### Geospatial Fields

- `location.point` - `geo_point` type for distance filtering

## API Endpoint

### POST `/hybrid-semantic/search`

**Headers:**

- `x-api-version: 1` (required)
- `x-tenant-id: {tenant-id}` (required)
- `accept-language: en` (optional, default: en)

**Request Body:**

```typescript
{
  // Query text (optional if taxonomy query provided)
  q?: string;

  // Language and pagination
  lang?: string;          // Default: "en"
  limit?: number;         // Default: 10, max: 100
  search_after?: any[];   // Cursor for deep pagination

  // Geospatial filtering
  lat?: number;
  lon?: number;
  distance?: number;      // Distance in miles
  location_point_only?: boolean;

  // Advanced taxonomy query (AND/OR logic)
  query?: {
    AND?: string[];       // All codes must match
    OR?: string[];        // Any code can match
  };

  // Facet filters (OR within field, AND across fields)
  facets?: {
    [field: string]: string[];
  };

  // Search mode options
  keyword_search_only?: boolean;
  disable_intent_classification?: boolean;

  // Response customization
  exclude_service_area?: boolean;

  // Advanced weight customization (0-10 scale)
  custom_weights?: {
    semantic?: {
      service?: number;        // Weight for service-level semantic search (default: 1.0)
      taxonomy?: number;       // Weight for taxonomy-level semantic search (default: 1.0)
      organization?: number;   // Weight for organization-level semantic search (default: 1.0)
    };
    strategies?: {
      semantic_search?: number;  // Overall semantic search weight (default: 1.0)
      keyword_search?: number;   // Keyword search weight (default: 1.0)
      intent_driven?: number;    // Intent-driven taxonomy weight (default: 1.0)
    };
    geospatial?: {
      weight?: number;           // Geospatial score multiplier (default: 2.0)
      decay_scale?: number;      // Distance where score drops to 50% (default: 50 miles)
      decay_offset?: number;     // Distance before decay starts (default: 0 miles)
    };
  };

  // DEPRECATED - Use custom_weights instead (kept for backward compatibility)
  semantic_weight?: number;
  attribute_weight?: number;
  taxonomy_weight?: number;
  geospatial_weight?: number;
  distance_decay_scale?: number;
  distance_decay_offset?: number;
}
```

**Response:**

```typescript
{
  took: number;           // Total time in ms
  timed_out: boolean;
  hits: {
    total: {
      value: number;
      relation: string;
    };
    max_score: number | null;
    hits: Array<{
      _index: string;
      _id: string;
      _score: number;
      _source: {
        // Document fields (embeddings removed)
      };
      _sources?: string[];  // Which search strategies found this result
      relevant_text?: string[];  // Sentences explaining why this result was surfaced
    }>;
  };
  search_after?: any[];
  metadata?: {
    search_pipeline: "hybrid_semantic";
    intent_classification?: {
      primary_intent: string;
      confidence: string;  // "high", "medium", "low"
      combined_taxonomy_codes: string[];
      is_low_information_query: boolean;
      // ... additional classification details
    };
    is_low_information_query?: boolean;
    granular_phase_timings?: {
      phase_1_embedding_and_classification?: {
        total_parallel_time: number;  // Wall clock time (max of parallel operations)
        embedding: number;             // Individual embedding time
        classification: number;        // Individual classification time
      };
      phase_2_opensearch?: {
        total_parallel_time: number;   // Total _msearch execution time
        individual_queries: {
          total?: number;
          semantic_service?: number;
          semantic_taxonomy?: number;
          semantic_organization?: number;
          keyword_original?: number;
          keyword_nouns?: number;
          keyword_nouns_stemmed?: number;
          intent_taxonomy?: number;
        };
      };
      phase_3_reranking?: {
        total_time: number;
      };
      phase_4_post_processing?: {
        total_time: number;
      };
    };
    sources_of_top_hits?: Array<{
      id: string;
      organization_name?: string;
      organization_description?: string;
      service_name?: string;
      service_description?: string;
      rank: number;
      total_document_relevance_score: number;  // Final combined score
      sources: Array<{
        strategy: string;           // Strategy name (e.g., 'semantic_service', 'keyword_original')
        pre_weight_score: number;   // Score before strategy weight was applied
        strategy_weight: number;    // Weight multiplier applied to this strategy
      }>;
    }>;
  };
}
```

### Enhanced Metadata for Result Traceability

The `sources_of_top_hits` metadata provides comprehensive traceability for each search result, enabling quality evaluation and debugging:

#### Document Information
- **organization_name** & **organization_description**: Full organization details for context
- **service_name** & **service_description**: Service-level information for understanding the resource
- **rank**: Position in the final result set (1-indexed)
- **total_document_relevance_score**: The final combined score after all strategies and weights

#### Detailed Source Contributions

Each result includes a `sources` array that breaks down exactly how the document's score was calculated:

```typescript
sources: [
  {
    strategy: "semantic_service",
    pre_weight_score: 0.8234,
    strategy_weight: 1.0
  },
  {
    strategy: "keyword_original",
    pre_weight_score: 2.4567,
    strategy_weight: 1.0
  }
]
```

**Benefits:**
- ✅ **Full Auditability**: Trace exactly which strategies contributed to each result
- ✅ **Score Transparency**: See pre-weight scores and the weights applied
- ✅ **Quality Evaluation**: Identify which strategies are performing well/poorly
- ✅ **Debugging**: Understand why specific results were ranked highly
- ✅ **A/B Testing**: Compare strategy effectiveness across different weight configurations

**Example Use Case:**

If a result has a high score but seems irrelevant, you can examine the `sources` array to see:
- Which strategy contributed most to the score
- Whether the weight on that strategy should be adjusted
- If the pre-weight score was genuinely high or artificially boosted

This granular visibility enables continuous improvement of the search algorithm and helps build trust in the results.

## Search Strategies

### 1. Service Semantic Search

Uses KNN on `service.embedding` field for semantic similarity at the service level.

### 2. Taxonomy Semantic Search

Uses KNN on `taxonomies[].embedding` field to find semantically similar taxonomy categories.

### 3. Organization Semantic Search

Uses KNN on `organization.embedding` field for organization-level semantic matching.

### 4. Keyword Search (Simplified Noun-Focused Strategy)

Executes **three focused keyword searches** that eliminate low-quality query variations:

#### 4a. Original Query Search (weight: 1.0x)
- Preserves the full user query exactly as entered
- Captures natural phrases and complete user intent
- Uses `multi_match` with `operator: and` for precise matching
- **Best for**: Exact phrase matching and preserving full context

**Example**: `"I need help with laundry"` → `"I need help with laundry"`

#### 4b. Nouns Search (weight: 0.95x)
- Uses **POS (Part-of-Speech) tagging** via `wink-nlp` to extract only NOUN and PROPN tokens
- Focuses on the most semantically important words (subjects/objects)
- Filters out verbs, adjectives, and other less critical parts of speech
- Uses `multi_match` with `operator: or` for flexible matching
- **Best for**: Precise semantic matching on core concepts

**Example transformations**:
- `"I need help with laundry"` → nouns: `["laundry"]` ✅
- `"I need help with my grocery and utility bills"` → nouns: `["grocery", "utility", "bills"]`
- `"food bank assistance"` → nouns: `["food", "bank", "assistance"]`
- `"Where can I find housing"` → nouns: `["housing"]`

#### 4c. Stemmed Nouns Search (weight: 0.85x)
- Takes the extracted nouns and applies stemming
- Catches corpus variations where documents use different word forms
- Uses `multi_match` with `operator: or` for flexible matching
- **Best for**: Matching "laundry" in query to "laundri" in corpus

**Example transformations**:
- `"I need help with laundry"` → stemmed nouns: `["laundri"]`
- `"I need help with my grocery and utility bills"` → stemmed nouns: `["groceri", "util", "bill"]`
- `"food bank assistance"` → stemmed nouns: `["food", "bank", "assist"]`

**Why this simplified approach?**
- ❌ **Removed**: Stemmed content words (e.g., `"need help laundri"`) - includes non-semantic words
- ❌ **Removed**: Bigrams (e.g., `"need help help laundry"`) - produces zero results due to corpus mismatch
- ✅ **Kept**: Original query for full intent + Nouns for semantic focus + Stemmed nouns for variations
- Focuses only on queries that produce meaningful results

**Searched fields** (all variations, with boost factors):
- `name^3` (highest priority)
- `description^2`
- `summary`
- `service.name^3`
- `service.description^2`
- `organization.name^2`
- `taxonomies.name`
- `taxonomies.description`

**Weight hierarchy**: Original (1.0x) > Nouns (0.95x) > Stemmed Nouns (0.85x)

### 5. Intent-Driven Taxonomy Search

Uses AI-classified intent to automatically select relevant taxonomy codes:

- Queries the ai-utils microservice for intent classification
- Receives `combined_taxonomy_codes` from the classification result
- Searches for services matching any of the taxonomy codes (OR logic)
- Only executes if query is not classified as "low information"
- Can be disabled with `disable_intent_classification: true`

## Relevant Text Extraction

Each search result includes a `relevant_text` field containing up to 3 sentences that explain **why the result was surfaced**. This helps users understand relevance, especially when the title doesn't obviously match their query.

### How It Works

1. **Extracts query nouns** using POS tagging (e.g., "laundry" from "I need help with laundry")
2. **Searches document fields** for sentences containing those nouns:
   - `description` (weight: 3)
   - `service.description` (weight: 3)
   - `summary` (weight: 2)
   - `service.summary` (weight: 2)
   - `schedule` (weight: 1)
3. **Scores sentences** based on noun matches and field importance
4. **Returns top 3** most relevant snippets

### Example

**Query**: `"I need help with laundry"`

**Result**: "COFFEE HALL | WASHINGTON STREET MISSION"

**relevant_text**:
```json
[
  "Shower and laundry facilities are also available by appointment",
  "Laundry is returned to the client the following day",
  "Laundry dropped off on Friday is returned the following Monday"
]
```

This allows the UI to display: *"Mentions that they offer: 'Shower and laundry facilities are also available by appointment.'"*

### Benefits

- ✅ **Builds user trust** - explains non-obvious matches
- ✅ **Improves UX** - users understand why results are relevant
- ✅ **Highlights key info** - surfaces the most important sentences
- ✅ **Automatic** - no manual annotation required

## Geospatial Features

### Hard Distance Filter

The `distance` parameter acts as a **hard filter** - results beyond this distance are completely excluded:

```typescript
{
  lat: 47.751076,
  lon: -120.740135,
  distance: 25  // Excludes all results beyond 25 miles
}
```

### Proximity Scoring (Gaussian Decay)

Within the filtered radius, results are scored based on proximity using a Gaussian decay function:

- **Nearer results** receive higher scores when semantic relevance is equal
- **Configurable via custom_weights.geospatial**:
  - `weight`: Multiplier for geospatial score (default: 2.0)
  - `decay_scale`: Distance where score drops to 50% (default: 50 miles)
  - `decay_offset`: Distance before decay starts (default: 0 miles)

**Example**: With `distance=50` and `decay_scale=25`:
- Results within 25 miles get higher proximity scores
- Score gradually decreases from 25-50 miles
- Results beyond 50 miles are excluded entirely

```typescript
{
  lat: 47.751076,
  lon: -120.740135,
  distance: 50,
  custom_weights: {
    geospatial: {
      weight: 3.0,        // Strong proximity preference
      decay_scale: 25,    // Score drops to 50% at 25 miles
      decay_offset: 5     // Full score within 5 miles
    }
  }
}
```

### Location Point Only

```typescript
{
  location_point_only: true; // Only results with specific coordinates
}
```

### Facet Filters

```typescript
{
  facets: {
    service_type: ["emergency", "ongoing"],
    cost: ["free"]
  }
}
```

## External Service Integration

### AI-Utils Microservice

The ai-utils microservice provides three key functions:

#### 1. Query Embeddings

**Endpoint:** `POST /api/embed`

**Request:**
```json
{
  "text": "user query text"
}
```

**Response:**
```json
{
  "embedding": [0.123, -0.456, ...]
}
```

#### 2. Intent Classification (SetFit Model)

**Endpoint:** `POST /api/classify`

**Request:**
```json
{
  "text": "I need help with my laundry"
}
```

**Response:**
```json
{
  "primary_intent": "Material Goods",
  "confidence": "high",
  "combined_taxonomy_codes": [
    "BH-3000",
    "BH-3700",
    "BM-6500.6500-450"
  ],
  "is_low_information_query": false,
  "top_intents": [
    { "intent": "Material Goods", "score": 0.92 }
  ]
}
```

#### 3. Result Reranking

**Endpoint:** `POST /api/rerank`

**Request:**
```json
{
  "query": "food assistance",
  "documents": [
    {
      "id": "resource-1",
      "text": "Food Bank Services - Provides emergency food assistance..."
    }
  ],
  "top_k": 10
}
```

**Response:**
```json
{
  "ranked_results": [
    { "id": "resource-1", "score": 0.95 }
  ]
}
```

## Configuration

Add to `.env`:

```bash
# OpenSearch
OPENSEARCH_NODE=http://localhost:9200

# AI Utils Microservice (embeddings, classification, reranking)
AI_UTILS_URL=http://localhost:8000
```

## Installation

1. Install dependencies:

```bash
npm install @opensearch-project/opensearch wink-nlp wink-eng-lite-web-model wink-nlp-utils
```

2. Add environment variables to `.env`

3. Module is automatically registered in `app.module.ts`

## Development Status

### ✅ Fully Implemented

- **Core Search Pipeline**:
  - 4-phase pipeline with parallel execution
  - Multi-strategy OpenSearch queries via _msearch
  - Result deduplication and combination
  - Cursor-based pagination with search_after

- **Search Strategies**:
  - Service-level semantic search (KNN)
  - Taxonomy-level semantic search (KNN)
  - Organization-level semantic search (KNN)
  - Simplified keyword search (original + nouns + stemmed nouns via POS tagging)
  - Intent-driven taxonomy search

- **NLP Features**:
  - Simplified keyword query variations focused on semantic meaning
  - POS (Part-of-Speech) tagging for noun extraction (wink-nlp)
  - Stemming applied only to extracted nouns for corpus variation matching
  - Weighted variation strategies (original > nouns > stemmed nouns)
  - Graceful fallback for edge cases

- **Geospatial Features**:
  - Hard distance filtering
  - Gaussian decay proximity scoring
  - Configurable decay parameters

- **AI Integration**:
  - Query embedding via ai-utils
  - Intent classification with SetFit model
  - Result reranking

- **Customization**:
  - Comprehensive weight system (custom_weights)
  - Per-strategy weight tuning
  - Geospatial scoring configuration

- **Infrastructure**:
  - Tenant mapping system
  - Granular performance timing
  - Source tracking for results
  - Comprehensive Swagger documentation

### 🚧 Future Enhancements

- Caching for embeddings/classifications
- Advanced metrics and monitoring
- A/B testing framework for weights
- Query expansion techniques
- Synonym handling

## Pagination

The hybrid semantic search endpoint supports **cursor-based pagination** using the `search_after` parameter. This approach is more efficient than offset-based pagination, especially for deep pagination scenarios.

### How It Works

1. **First Request**: Make a search request without `search_after`
2. **Response**: The response includes a `search_after` array in the root level if there are more results
3. **Next Page**: Use the `search_after` value from the previous response in your next request
4. **Repeat**: Continue until `search_after` is not returned (no more results)

### Example: Paginating Through Results

#### Request 1 (First Page)

```bash
curl -X POST http://localhost:3000/v1/hybrid-semantic/search \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: il211" \
  -H "x-api-version: 1" \
  -d '{
    "q": "food assistance",
    "limit": 10
  }'
```

#### Response 1

```json
{
  "took": 245,
  "timed_out": false,
  "hits": {
    "total": { "value": 50, "relation": "eq" },
    "max_score": 0.95,
    "hits": [
      // ... 10 results
    ]
  },
  "search_after": [0.85, "resource-10"],
  "metadata": {
    /* ... */
  }
}
```

#### Request 2 (Second Page)

```bash
curl -X POST http://localhost:3000/v1/hybrid-semantic/search \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: il211" \
  -H "x-api-version: 1" \
  -d '{
    "q": "food assistance",
    "limit": 10,
    "search_after": [0.85, "resource-10"]
  }'
```

#### Response 2

```json
{
  "took": 198,
  "timed_out": false,
  "hits": {
    "total": { "value": 50, "relation": "eq" },
    "max_score": 0.84,
    "hits": [
      // ... next 10 results
    ]
  },
  "search_after": [0.75, "resource-20"],
  "metadata": {
    /* ... */
  }
}
```

### Important Notes

- **Consistency**: The `search_after` values are based on `[_score, _id]` to ensure consistent ordering
- **Same Query**: You must use the same query parameters (filters, sorting) across paginated requests
- **No Random Access**: Cursor-based pagination doesn't support jumping to arbitrary pages
- **Stateless**: The cursor is stateless - no server-side state is maintained
- **Limit**: Maximum `limit` is 100 results per page (configurable in the DTO)

### TypeScript/JavaScript Example

```typescript
async function getAllResults(query: string, limit: number = 10) {
  const allResults = [];
  let searchAfter = undefined;

  while (true) {
    const response = await fetch(
      'http://localhost:3000/v1/hybrid-semantic/search',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': 'il211',
          'x-api-version': '1',
        },
        body: JSON.stringify({
          q: query,
          limit,
          ...(searchAfter && { search_after: searchAfter }),
        }),
      },
    );

    const data = await response.json();
    allResults.push(...data.hits.hits);

    // Check if there are more results
    if (!data.search_after) {
      break; // No more pages
    }

    searchAfter = data.search_after;
  }

  return allResults;
}
```

## Usage Example

```typescript
// POST /hybrid-semantic/search
{
  "q": "food assistance for families",
  "lat": 47.751076,
  "lon": -120.740135,
  "distance": 10,
  "limit": 10,
  "query": {
    "OR": ["BD-1800", "BD-1900"]  // Food banks or food pantries
  },
  "facets": {
    "cost": ["free"]
  }
}
```

## Performance Optimization

### Multi-Variation Keyword Search Benefits

The multi-variation approach significantly improves search quality:

**Problem**: Complex query processing can produce low-quality searches:
- Stemmed content words: `"need help laundri"` (includes non-semantic words)
- Bigrams: `"need help help laundry"` (zero results due to corpus mismatch)

**Solution**: Simplified noun-focused strategy:
1. **Original**: Preserves complete user intent and phrases
2. **Nouns**: POS-tagged extraction of core semantic concepts
3. **Stemmed Nouns**: Catches corpus variations ("laundry" vs "laundri")

**Example**: `"I need help with laundry"`
- Original search: `"I need help with laundry"` - full context
- Nouns search: `"laundry"` - core concept
- Stemmed nouns search: `"laundri"` - catches corpus variations

**Results**:
- ✅ Better precision - focuses only on semantically meaningful queries
- ✅ Eliminates noise - removes queries that produce zero or irrelevant results
- ✅ Semantic focus - POS-tagged nouns extract core meaning
- ✅ Corpus variation matching - stemmed nouns catch different word forms
- ✅ Deduplication - results combined with best scores

### Parallel Execution

The pipeline maximizes performance through parallelization:

- **Phase 1**: Embedding and classification run simultaneously
- **Phase 2**: All 5-6 search strategies execute in a single _msearch call (3 semantic + 3 keyword + 1 intent)
- **Typical timing**: 200-400ms total for complex queries

### Response Optimization

- All embedding vectors are stripped from responses
- Service area polygons can be excluded with `exclude_service_area: true`
- Reduces response size by 80-90%

## Notes

- The module follows NestJS best practices and matches the existing codebase architecture
- Tenant mapping is centralized in `src/common/config/tenant-mapping.config.ts`
- AI-utils service is shared across modules in `src/common/services/ai-utils.service.ts`
- All search strategies respect the same filters (geospatial, facets, etc.)
