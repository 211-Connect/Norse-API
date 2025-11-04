# Semantic Taxonomy Suggestion API

## Overview

This API endpoint provides real-time taxonomy suggestions as users type their search queries. It uses **intent classification** to predict relevant taxonomy codes, eliminating the need for runtime embedding generation and significantly improving response times.

## Endpoint

```
GET /semantic-taxonomy-suggestion?query={query}&limit={limit}&lang={lang}&code={code}
```

### Query Parameters
- `query` (required): User search query (e.g., "food assistance")
- `limit` (optional): Number of suggestions to return (default: 10, max: 50)
- `lang` (optional): Language/locale for search (default: "en")
- `code` (optional): Taxonomy code prefix to filter results (e.g., "BD")

### Headers
- `x-tenant-id` (required): Tenant identifier
- `x-api-version` (required): API version (e.g., "1")
- `accept-language` (optional): Language preference

## Logic Flow

### 1. Query Classification (Phase 1)
```typescript
const classification = await aiUtilsService.classifyQuery(query);
```

**Purpose**: Predict which taxonomy codes are relevant to the user's query using a trained classification model.

**Output**:
- `primary_intent`: Main intent category (e.g., "Food", "Housing")
- `combined_taxonomy_codes`: Array of predicted taxonomy codes (e.g., ["BD-1800.2000", "BD-1800.2250"])
- `confidence`: Classification confidence level ("high", "medium", "low")
- `is_low_information_query`: Boolean indicating if query is too vague

**Example**:
```json
{
  "primary_intent": "Food",
  "combined_taxonomy_codes": ["BD-1800.2000", "BD-1800.2250", "BD-1875.2000"],
  "confidence": "high",
  "is_low_information_query": false
}
```

### 2. Multi-Strategy OpenSearch Query (Phase 2)

The service executes up to 2 search strategies in parallel using OpenSearch `_msearch`:

#### Strategy A: Intent-Driven Taxonomy Search
**Condition**: Only if classification returned taxonomy codes AND query is not low-information.  The classifier only gives the code back not the name of the taxonomy. So we need to currently do this trip to OpenSearch to get the name of the taxonomy.

**Query Type**: Exact match on taxonomy codes
```typescript
{
  nested: {
    path: 'taxonomies',
    query: {
      terms: {
        'taxonomies.code': classificationCodes // e.g., ["BD-1800.2000", "BD-1800.2250"]
      }
    }
  }
}
```

**Purpose**: Find resources that have the taxonomies predicted by the classifier.

#### Strategy B: Text Matching (Fallback)
**Condition**: Always executed

**Query Type**: Text search on taxonomy names and codes
```typescript
{
  nested: {
    path: 'taxonomies',
    query: {
      multi_match: {
        query: userQuery, // e.g., "food"
        fields: ['taxonomies.name', 'taxonomies.code']
      }
    }
  }
}
```

**Purpose**: Catch taxonomies that match the query text directly (autocomplete-style).

### 3. Taxonomy Aggregation & Filtering (Phase 3)

**Key Innovation**: Only aggregate taxonomies that actually matched, not all taxonomies from matched resources.

```typescript
results.forEach((resource) => {
  resource.taxonomies.forEach((taxonomy) => {
    const isFromClassification = classificationCodes.has(taxonomy.code);
    
    // Filtering logic
    if (isFromClassification) {
      // Always include taxonomies from classification
      include(taxonomy);
    } else {
      // Only include if taxonomy name/code contains query text
      if (taxonomy.name.includes(query) || taxonomy.code.includes(query)) {
        include(taxonomy);
      }
    }
  });
});
```

### 4. Scoring & Ranking (Phase 4)

Each unique taxonomy is scored based on:

```typescript
finalScore = avgScore + resourceCountBoost + classificationBoost

where:
  avgScore = average OpenSearch score across all occurrences
  resourceCountBoost = log(resourceCount + 1) * 0.1
  classificationBoost = 0.5 (if from classification) or 0
```

**Factors**:
1. **OpenSearch relevance score**: How well the taxonomy matched the query
2. **Resource count**: How many resources have this taxonomy (popularity signal)
3. **Classification boost**: Extra weight for taxonomies predicted by the classifier

### 5. Response Construction

```json
{
  "took": 631,
  "suggestions": [
    {
      "code": "BD-1800.2000",
      "name": "Food Pantries",
      "description": null,
      "score": 2.609861228866811,
      "match_type": "intent",
      "resource_count": 38
    }
  ],
  "metadata": {
    "query": "food",
    "total_unique_taxonomies": 10,
    "search_strategy": "intent_classification",
    "embedding_used": false,
    "classification": {
      "primary_intent": "Food",
      "confidence": "high",
      "is_low_information_query": false,
      "taxonomy_codes_count": 10
    }
  }
}
```

**Match Types**:
- `intent`: Taxonomy came from classification only
- `text`: Taxonomy came from text matching only
- `hybrid`: Taxonomy matched both strategies

## Architecture Benefits

### 🚀 Performance
- **No runtime embeddings**: Eliminates Ollama API calls (previously ~200-400ms)
- **Faster response times**: Classification is faster than embedding generation
- **Reduced load**: No burden on embedding service during peak usage

### 🎯 Accuracy
- **Intent-aware**: Uses trained model that understands user intent
- **Filtered results**: Only returns taxonomies that actually matched
- **Confidence signals**: Metadata includes classification confidence

### 🔍 Transparency
- **Explainable**: Response shows which intent was detected
- **Debuggable**: Match types show how each taxonomy was found
- **Metadata-rich**: Full classification details in response

## Key Components

### Service Layer
- **`SemanticTaxonomySuggestionService`**: Main orchestration logic
  - `getTaxonomySuggestions()`: Entry point
  - `executeTaxonomySearch()`: Multi-strategy OpenSearch execution
  - `aggregateTaxonomies()`: Filtering and scoring logic
  - `buildIntentTaxonomyQuery()`: Intent-driven query builder
  - `buildTextTaxonomyQuery()`: Text matching query builder

### External Dependencies
- **`AiUtilsService.classifyQuery()`**: Intent classification via ai-utils microservice
- **OpenSearch**: Document and taxonomy storage/search
- **ai-utils microservice**: SetFit-based intent classification model

## Example Flow

```
User Query: "food"
     ↓
[1] Classification
     → Intent: "Food"
     → Codes: ["BD-1800.2000", "BD-1800.2250", "BD-1875.2000", ...]
     ↓
[2] OpenSearch Multi-Search
     → Strategy A: Find resources with codes ["BD-1800.2000", ...]
     → Strategy B: Find resources where taxonomy name/code contains "food"
     ↓
[3] Filter & Aggregate
     → Resource 1: Has ["Food Pantries", "Maternity Clothing"]
        ✓ Include "Food Pantries" (from classification)
        ✗ Exclude "Maternity Clothing" (not in classification, doesn't match "food")
     ↓
[4] Score & Rank
     → "Food Pantries": score = 2.6 (38 resources, from classification)
     → "Food Stamps": score = 2.1 (2 resources, from classification)
     ↓
[5] Return Top N
     → Returns 10 food-related taxonomies only
```

## Configuration

The service uses the following environment variables:
- `AI_UTILS_URL`: Base URL for ai-utils microservice (classification)
- `OPENSEARCH_NODE`: OpenSearch cluster endpoint

## Testing

```bash
# Basic query
curl 'http://localhost:8080/semantic-taxonomy-suggestion?query=food&limit=10' \
  -H 'x-api-version: 1' \
  -H 'x-tenant-id: 0e50850f-6a7f-49c1-9af8-7d124e2a7008' \
  -H 'Accept-Language: en'

# With taxonomy code filter
curl 'http://localhost:8080/semantic-taxonomy-suggestion?query=housing&limit=5&code=BH' \
  -H 'x-api-version: 1' \
  -H 'x-tenant-id: 0e50850f-6a7f-49c1-9af8-7d124e2a7008'
```

## Future Enhancements

- [ ] Cache classification results for common queries
- [ ] Add support for multi-language classification
- [ ] Implement query expansion for low-confidence classifications
- [ ] Add A/B testing framework to compare with embedding-based approach
