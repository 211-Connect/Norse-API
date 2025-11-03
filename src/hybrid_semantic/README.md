# Hybrid Semantic Search Module

## Overview

This module implements an advanced hybrid semantic search system that combines:

- **Semantic search** using vector embeddings (KNN)
- **Keyword search** across text fields
- **Intent-driven taxonomy queries** with AND/OR logic
- **Geospatial filtering** for location-based results
- **AI-powered reranking** via the ai-utils microservice

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
│ ┌─────────────────┐ ┌─────────────────┐                   │
│ │ Keyword         │ │ Intent-Driven   │                   │
│ │ Search          │ │ Taxonomy        │                   │
│ └─────────────────┘ └─────────────────┘                   │
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
├── config/
│   ├── tenant-mapping.config.ts   # Tenant name to short code mapping
│   ├── tenant-mapping.config.spec.ts # Tests for tenant mapping
│   └── README.md                  # Configuration documentation
├── dto/
│   ├── search-request.dto.ts      # Request validation schema
│   ├── search-response.dto.ts     # Response types
│   └── taxonomy-query.dto.ts      # Taxonomy query types
├── services/
│   ├── ai-utils.service.ts        # AI-utils microservice client
│   └── opensearch.service.ts      # OpenSearch query builder
├── hybrid-semantic.controller.ts  # HTTP endpoint
├── hybrid-semantic.service.ts     # Main orchestration logic
├── hybrid-semantic.module.ts      # NestJS module
└── README.md                      # This file
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

  // Advanced ranking weights (0.0-1.0)
  semantic_weight?: number;
  attribute_weight?: number;
  taxonomy_weight?: number;
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
    }>;
  };
  search_after?: any[];
  metadata?: {
    search_pipeline: "hybrid_semantic";
    intent_classification?: {
      intent: string;
      confidence: number;
    };
    phase_timings?: {
      embedding_and_classification: number;
      opensearch_query: number;
      reranking: number;
      post_processing: number;
    };
  };
}
```

## Search Strategies

### 1. Service Semantic Search

Uses KNN on `service.embedding` field for semantic similarity at the service level.

### 2. Taxonomy Semantic Search

Uses KNN on `taxonomies[].embedding` field to find semantically similar taxonomy categories.

### 3. Organization Semantic Search

Uses KNN on `organization.embedding` field for organization-level semantic matching.

### 4. Keyword Search

Multi-match query across text fields:

- `name^3` (boosted)
- `description^2` (boosted)
- `service.name^3`
- `service.description^2`
- `organization.name^2`
- `taxonomies.name`
- `taxonomies.description`

### 5. Intent-Driven Taxonomy Search

Uses classified intent and advanced AND/OR taxonomy logic to filter results.

## Filters

All search strategies respect these filters:

### Geospatial Distance

```typescript
{
  lat: 47.751076,
  lon: -120.740135,
  distance: 25  // miles
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

### Ollama (Embeddings)

Uses Ollama's **OpenAI-compatible API** for generating query embeddings.

**Endpoint:** `POST /v1/embeddings`

**Request:**

```json
{
  "model": "bge-m3:567m",
  "input": "user query text"
}
```

**Response:**

```json
{
  "data": [
    {
      "embedding": [0.123, -0.456, ...],
      "index": 0
    }
  ],
  "model": "bge-m3:567m",
  "usage": { ... }
}
```

**Configuration:**

- `OLLAMA_BASE_URL` - Default: `http://localhost:11434`
- `OLLAMA_EMBEDDING_MODEL` - Default: `bge-m3:567m`

### AI-Utils Microservice (Classification & Reranking)

1. **POST /api/classify** - Intent classification
   - Input: `{ text: string }`
   - Output: `{ intent: string, confidence: number, entities: {} }`

2. **POST /api/rerank** - Result reranking
   - Input: `{ query: string, documents: Array<{id, text}>, top_k: number }`
   - Output: `{ ranked_results: Array<{id, score}> }`

## Configuration

Add to `.env`:

```bash
# OpenSearch (for testing: localhost:9200, no auth)
OPENSEARCH_NODE=http://localhost:9200

# Ollama (for embeddings via OpenAI-compatible API)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBEDDING_MODEL=bge-m3:567m

# AI Utils Microservice (for classification and reranking)
AI_UTILS_URL=http://localhost:8000
```

## Installation

1. Install OpenSearch client:

```bash
npm install @opensearch-project/opensearch
```

2. Add environment variables to `.env`

3. Module is automatically registered in `app.module.ts`

## Development Status

### ✅ Completed

- Module structure and organization
- DTO definitions with Zod validation
- Service stubs for ai-utils integration
- OpenSearch query builders
- Main orchestration service
- Controller with Swagger documentation
- Module registration and middleware setup

### ✅ Implemented

- Ollama embeddings via OpenAI-compatible API

### 🚧 TODO (Pseudocode Stubs)

- Implement ai-utils classification API call
- Implement ai-utils reranking API call
- Implement actual OpenSearch client initialization
- Implement actual \_msearch execution
- Add tenant short-code mapping logic
- Add error handling and retry logic
- Add caching for embeddings/classifications
- Add metrics and monitoring
- Add unit tests
- Add integration tests

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

## Notes

- All embedding fields are automatically removed from responses to reduce payload size
- The `tenant` parameter is available in services but currently unused (reserved for future multi-tenancy features)
- Lint errors are expected in stub code and will be resolved during implementation
- The module follows NestJS best practices and matches the existing codebase architecture
