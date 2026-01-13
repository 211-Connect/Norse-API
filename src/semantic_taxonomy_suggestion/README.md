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
- `code` (optional): Taxonomy code prefix(es) to filter results. Supports hierarchical filtering.
  - Single prefix: `code=BD` (returns all taxonomies starting with "BD")
  - Multiple prefixes: `code=BD&code=LR` (returns taxonomies starting with "BD" OR "LR")
  - Hierarchical levels: `code=LR-8000` (returns all taxonomies under LR-8000 hierarchy)

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

**Search Strategy Determination**:
- **`intent_classification`**: Classifier returned taxonomy codes → uses intent-driven search
- **`text_matching`**: Classifier returned 0 codes or low confidence → falls back to text search only

**NLP-Based Text Matching** (using [wink-nlp-utils](https://www.npmjs.com/package/wink-nlp-utils)):

When classification fails or returns low confidence, the system uses sophisticated NLP techniques:

1. **Tokenization**: Breaks text into meaningful tokens
2. **Stop Word Removal**: Removes common words ("a", "the", "with", "for")
3. **Stemming**: Reduces words to root form ("mothers" → "mother", "children" → "child")
4. **Bigram Analysis**: Looks for two-word phrase matches
5. **Substring Matching**: Catches compound words and variations

**Example**: Query "single mother with two kids"
```
Original: "single mother with two kids"
   ↓ Tokenization
["single", "mother", "with", "two", "kids"]
   ↓ Stop Word Removal
["single", "mother", "kids"]
   ↓ Stemming
["singl", "mother", "kid"]
   ↓ Matching
✓ Matches "Single Mothers Support Group" (stem: "mother")
✓ Matches "Parent-Child Programs" (stem: "kid" → "child")
✓ Matches "Single Parent Services" (bigram: ["single", "parent"])
```

```typescript
results.forEach((resource) => {
  resource.taxonomies.forEach((taxonomy) => {
    const isFromClassification = classificationCodes.has(taxonomy.code);
    
    // Filtering logic
    if (isFromClassification) {
      // Always include taxonomies from classification
      include(taxonomy);
    } else {
      // For text matches: use NLP-based matching with wink-nlp-utils
      // Multi-strategy approach:
      
      // 1. Tokenization & Stop Word Removal
      //    "single mother with two kids" → ["single", "mother", "kids"]
      
      // 2. Stemming
      //    "mothers" → "mother", "children" → "child"
      
      // 3. Exact Token Match (after stemming)
      //    Query: "mothers" → Stem: "mother"
      //    Taxonomy: "Single Mothers Support" → Stem: "mother"
      //    ✓ Match!
      
      // 4. Bigram Matching
      //    Query: "single mother" → Bigrams: [["single", "mother"]]
      //    Taxonomy: "Single Parent Mothers" → Bigrams: [["single", "parent"], ["parent", "mother"]]
      //    ✓ Partial match on context
      
      // 5. Substring Matching (for compound words)
      //    Query: "mother" matches "grandmother", "single-mother"
      
      if (matchesTextQuery(query, taxonomy.name, taxonomy.code)) {
        include(taxonomy);
      }
    }
  });
});
```

### 4. Scoring & Ranking (Phase 4) - **Blended Multi-Signal Approach**

Each unique taxonomy is scored using **4 weighted signals** for optimal ranking:

```typescript
finalScore = 
  (classificationScore × 0.4) +      // 40% - Intent relevance
  (textMatchScore × 0.3) +           // 30% - NLP text matching
  (openSearchScore × 0.2) +          // 20% - Search relevance
  (popularityScore × 0.1)            // 10% - Resource count
```

#### **Signal Breakdown**

**1. Classification Score (40% weight)** - Primary signal
```typescript
if (isFromClassification) {
  score = confidence === 'high' ? 1.0 :
          confidence === 'medium' ? 0.7 : 0.4;
} else {
  score = 0;
}
```
- Highest weight because classifier is trained on real user queries
- Confidence level modulates the score

**2. Text Match Score (30% weight)** - NLP-based relevance
```typescript
score = 
  (exactTokenMatches / totalTokens) × 0.5 +    // Stemmed word matches
  (bigramMatches / totalBigrams) × 0.3 +       // Phrase matches
  (substringMatches / totalTokens) × 0.2       // Partial matches
```
- Computed using wink-nlp-utils tokenization and stemming
- Rewards exact matches more than partial matches

**3. OpenSearch Score (20% weight)** - Search engine relevance
```typescript
score = min(avgOpenSearchScore / 10, 1.0)  // Normalized to 0-1
```
- Uses OpenSearch's BM25 scoring
- Normalized to prevent dominating other signals

**4. Popularity Score (10% weight)** - Usage signal
```typescript
score = min(log(resourceCount + 1) / log(100), 1.0)  // Normalized to 0-1
```
- More resources = more commonly needed service
- Logarithmic to prevent popular taxonomies from dominating

#### **Example: Scoring "Single Mother Support"**

Query: `"single mother with two kids"`

| Signal | Calculation | Score | Weight | Contribution |
|--------|-------------|-------|--------|--------------|
| Classification | In predicted codes, confidence=high | 1.0 | 40% | **0.40** |
| Text Match | "single"(0.5) + "mother"(0.5) / 2 tokens | 0.75 | 30% | **0.225** |
| OpenSearch | BM25 score: 8.5 / 10 | 0.85 | 20% | **0.17** |
| Popularity | log(26+1) / log(100) = 0.71 | 0.71 | 10% | **0.071** |
| **Final Score** | | | | **0.866** |

#### **Why This Approach?**

✅ **Broad Discovery**: Union of classification + text matching catches more candidates  
✅ **Precise Ranking**: Multi-signal scoring surfaces the most relevant results  
✅ **Balanced**: No single signal dominates (prevents over-reliance on any one method)  
✅ **Tunable**: Weights can be adjusted based on performance metrics  
✅ **Resilient**: If classification fails, text matching + OpenSearch still provide good results

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
- **wink-nlp-utils**: NLP library for tokenization, stemming, stop word removal, and n-gram generation

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

## Hierarchical Code Filtering Examples

The `code` parameter supports hierarchical taxonomy filtering based on the AIRS/211 LA taxonomy structure:

### Taxonomy Hierarchy Structure
```
Level I:   L (Health Care)
Level II:  LR (Rehabilitation/Habilitation Services)
Level III: LR-8000 (Speech and Hearing)
Level IV:  LR-8000.0500 (Audiology)
Level V:   LR-8000.0500-800 (Sign Language Instruction)
Level VI:  LR-8000.0500-800.05 (American Sign Language)
```

### Example 1: Filter by Top-Level Category
```bash
GET /semantic-taxonomy-suggestion?query=assistance&code=B
```
Returns only taxonomies starting with "B" (Basic Needs):
- `BD-1800` - Food Pantries
- `BH-1800` - Homeless Shelters
- `BD-1800.2000` - Emergency Food
- etc.

### Example 2: Filter by Multiple Top-Level Categories
```bash
GET /semantic-taxonomy-suggestion?query=assistance&code=B&code=L
```
Returns taxonomies starting with "B" OR "L":
- `BD-1800` - Food Pantries (Basic Needs)
- `LR-8000` - Speech and Hearing (Health Care)
- `BH-1800` - Homeless Shelters (Basic Needs)
- etc.

Filters out all other categories like "F" (Criminal Justice), "D" (Consumer Services), etc.

### Example 3: Filter by Specific Subcategory
```bash
GET /semantic-taxonomy-suggestion?query=food&code=BD-1800
```
Returns only taxonomies under the "Food Pantries" hierarchy:
- `BD-1800` - Food Pantries
- `BD-1800.2000` - Emergency Food
- `BD-1800.1500` - Food Delivery
- etc.

### Example 4: Multiple Subcategories
```bash
GET /semantic-taxonomy-suggestion?query=support&code=BD-1800&code=LR-8000
```
Returns taxonomies from both hierarchies:
- `BD-1800.2000` - Emergency Food
- `LR-8000.0500` - Audiology
- `LR-8000.0500-800` - Sign Language Instruction
- etc.

## Troubleshooting

### No Results Returned

**Symptom**: Query returns empty `suggestions` array

**Possible Causes**:

1. **Classifier returned 0 taxonomy codes** (`taxonomy_codes_count: 0`)
   - The query doesn't match any trained intents
   - Falls back to `text_matching` strategy
   - Solution: Improve classifier training data or adjust confidence thresholds

2. **Text matching found no NLP matches**
   - After tokenization, stemming, and n-gram analysis, no taxonomies matched
   - Example: "single mother with two kids" → uses NLP to match stems like "mother", "kid", "parent"
   - The system tries multiple strategies: exact token match, bigrams, and substring matching
   - Solution: Query may be too specific, or taxonomies may use very different terminology

3. **No resources in the index**
   - Check if OpenSearch index exists and has data
   - Verify tenant ID is correct

**Example**:
```json
{
  "search_strategy": "text_matching",
  "classification": {
    "primary_intent": null,
    "confidence": "low",
    "taxonomy_codes_count": 0
  }
}
```
This indicates the classifier couldn't identify an intent, so only text matching ran.

### Low Relevance Results

**Symptom**: Results are returned but seem unrelated

**Check**:
- `match_type` field: Shows how each taxonomy was found
  - `intent`: From classification (usually more accurate)
  - `text`: From text matching (may be less precise)
  - `hybrid`: Matched both ways
- `confidence` in metadata: "low" confidence may produce weaker results

## Future Enhancements

- [ ] Cache classification results for common queries
- [ ] Add support for multi-language classification
- [ ] Implement query expansion for low-confidence classifications
- [ ] Add A/B testing framework to compare with embedding-based approach
- [ ] Improve handling of demographic/persona-based queries (e.g., "single mother")
- [ ] Add synonym expansion for text matching fallback
