# OpenSearch Integration

## Overview

The `OpenSearchService` provides a complete interface to the OpenSearch cluster for hybrid semantic search. It executes multi-strategy searches combining semantic embeddings, keyword matching, and intent-driven queries.

## Configuration

### Environment Variables

Set the following in your `.env` file:

```env
OPENSEARCH_NODE=http://localhost:9200
```

For production with authentication:

```env
OPENSEARCH_NODE=https://your-opensearch-cluster.com:9200
OPENSEARCH_USERNAME=admin
OPENSEARCH_PASSWORD=your-password
```

## Index Structure

Documents are stored in tenant-specific indexes with the naming convention:
```
{tenant-short-code}-resources_{locale}
```

The locale is taken from the `lang` field in the request body (defaults to `'en'`).

Examples:
- `wa211-resources_en`
- `ca211-resources_es`
- `ca211-resources_fr`

## Document Schema

Each document follows the mapping defined in the Python index builder with these key fields:

### Top-Level Fields
- `id`: Document identifier (keyword)
- `tenant_id`: Tenant identifier (keyword)
- `locale`: Language locale (keyword)
- `name`: Resource name (text with keyword subfield)
- `description`: Full description (text)
- `summary`: Brief summary (text)
- `embedding`: Top-level embedding vector (knn_vector, dimension 768)

### Nested Objects

#### Service
- `service.name`: Service name (text with keyword)
- `service.description`: Service description (text)
- `service.embedding`: Service-level embedding (knn_vector)
- `service.status`: Service status (keyword)

#### Organization
- `organization.name`: Organization name (text with keyword)
- `organization.description`: Organization description (text)
- `organization.embedding`: Organization-level embedding (knn_vector)

#### Taxonomies (Array)
- `taxonomies[].code`: Taxonomy code (keyword)
- `taxonomies[].name`: Taxonomy name (text with keyword)
- `taxonomies[].description`: Taxonomy description (text)
- `taxonomies[].embedding`: Taxonomy-level embedding (knn_vector)

#### Location
- `location.name`: Location name (text with keyword)
- `location.point`: Geographic coordinates (geo_point)
- `location.physical_address`: Address object

## Search Strategies

The service implements 5 parallel search strategies:

### 1. Service-Level Semantic Search
Searches using KNN on `service.embedding` field. Best for queries about specific services.

### 2. Taxonomy-Level Semantic Search
Searches using KNN on `taxonomies[].embedding` field. Best for category-based queries.

### 3. Organization-Level Semantic Search
Searches using KNN on `organization.embedding` field. Best for organization-specific queries.

### 4. Keyword Search (Optional)
Traditional text search using `multi_match` across multiple text fields. Can be disabled via `disable_intent_classification` flag.

### 5. Intent-Driven Taxonomy Search
Uses taxonomy codes from intent classification with AND/OR logic.

## Usage

### Basic Search

```typescript
import { OpenSearchService } from './services/opensearch.service';

// Inject the service
constructor(private readonly openSearchService: OpenSearchService) {}

// Execute hybrid search
const results = await this.openSearchService.executeHybridSearch(
  queryEmbedding,      // number[] - embedding vector
  searchRequest,       // SearchRequestDto (includes lang field)
  headers,            // HeadersDto (includes x-tenant-id)
  intentClassification // optional intent data
);
```

### Health Check

```typescript
const health = await this.openSearchService.checkHealth();
console.log(health);
// { status: 'connected', cluster: { ... } }
```

### Check Index Existence

```typescript
const exists = await this.openSearchService.indexExists('wa211-resources_en');
console.log(exists); // true or false
```

### Strip Embeddings from Results

```typescript
// Remove embedding vectors to reduce payload size
const cleanResults = this.openSearchService.stripEmbeddings(results);
```

## Filters

The service supports multiple filter types:

### Geospatial Filter
```typescript
{
  lat: 47.751076,
  lon: -120.740135,
  distance: 10 // miles
}
```

### Location Point Filter
```typescript
{
  location_point_only: true // Only return resources with coordinates
}
```

### Facet Filters
```typescript
{
  facets: {
    service_type: ['food', 'housing'],
    target_audience: ['seniors'],
    cost: ['free']
  }
}
```

## Query Structure

### KNN Query for Nested Fields

```json
{
  "size": 50,
  "query": {
    "nested": {
      "path": "service",
      "query": {
        "knn": {
          "service.embedding": {
            "vector": [0.1, 0.2, ...],
            "k": 50
          }
        }
      }
    }
  }
}
```

### Keyword Query

```json
{
  "size": 50,
  "query": {
    "bool": {
      "must": [
        {
          "multi_match": {
            "query": "food assistance",
            "fields": [
              "name^3",
              "description^2",
              "service.name^3",
              "service.description^2"
            ],
            "type": "best_fields"
          }
        }
      ],
      "filter": [...]
    }
  }
}
```

## Result Deduplication

The service automatically deduplicates results across all search strategies using document `_id`. Each document appears only once in the final result set.

## Performance Considerations

### Candidates Per Strategy
Default: 50 candidates per strategy
- Adjust based on your needs
- Higher values = more comprehensive but slower
- Lower values = faster but may miss relevant results

### Index Settings
```json
{
  "number_of_shards": 2,
  "number_of_replicas": 1,
  "knn.algo_param.ef_search": 100
}
```

### HNSW Parameters
```json
{
  "ef_construction": 512,
  "m": 16
}
```

## Error Handling

The service logs errors and throws exceptions for:
- Connection failures
- Index not found
- Malformed queries
- Timeout errors

Always wrap calls in try-catch blocks:

```typescript
try {
  const results = await this.openSearchService.executeHybridSearch(...);
} catch (error) {
  this.logger.error('Search failed', error);
  // Handle error appropriately
}
```

## Security

### Development
The service is configured with `rejectUnauthorized: false` for development environments without SSL certificates.

### Production
Update the client configuration in the constructor:

```typescript
this.client = new Client({
  node: this.configService.get<string>('OPENSEARCH_NODE'),
  auth: {
    username: this.configService.get<string>('OPENSEARCH_USERNAME'),
    password: this.configService.get<string>('OPENSEARCH_PASSWORD'),
  },
  ssl: {
    rejectUnauthorized: true,
    ca: fs.readFileSync('/path/to/ca.crt'),
  },
});
```

## Testing

### Mock Results
The service includes a `getMockSearchResults()` method for testing without a live cluster.

### Integration Tests
Ensure your test environment has:
1. OpenSearch cluster running
2. Test indexes created with proper mappings
3. Sample documents loaded

## Troubleshooting

### Connection Refused
- Verify `OPENSEARCH_NODE` is correct
- Check OpenSearch is running: `curl http://localhost:9200`
- Check firewall rules

### Index Not Found
- Verify index naming convention
- Check tenant ID mapping
- Ensure indexes are created before searching

### No Results
- Verify documents are indexed
- Check filter criteria aren't too restrictive
- Verify embedding dimensions match (768)
- Test with keyword-only search first

### Slow Queries
- Reduce `candidatesPerStrategy`
- Optimize index settings
- Add more shards for larger datasets
- Consider caching frequent queries

## Related Files

- `opensearch.service.ts` - Main service implementation
- `../dto/search-request.dto.ts` - Search request structure
- `../../common/dto/headers.dto.ts` - Header definitions
- `../hybrid-semantic.service.ts` - Orchestration layer
