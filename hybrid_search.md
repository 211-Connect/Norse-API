GOAL:
Implement a new search mode `query_type=hybrid` that preserves the current user experience and filtering behavior, while adding hybrid retrieval (lexical + vector) and taxonomy-aware boosting. The implementation must be **additive**: do not break or change existing behavior for other `query_type` values. The hybrid mode should:
1) Generate an embedding for the user query using an external embedding service (Ollama OpenAI-compatible API).
2) Retrieve relevant taxonomy codes from the `hybrid_taxonomies` index using vector search (3–5 candidates).
3) Run hybrid retrieval against `hybrid_search_resources_{lang}` using `_msearch` (BM25 + kNN) with client-side fusion (RRF) and taxonomy-code boosting in BM25.
4) Rerank the fused candidate set to improve final ordering (especially for close geo matches and strong name matches), while respecting existing filters.

CONSTRAINS:
- Elasticsearch version: 8.18 (self-hosted). Do not use Enterprise-only features (e.g., retrievers/linear/RRF server-side).
- This work must be **additive**: inspect the current search implementation in `search.service.ts` and keep the existing filtering logic intact (tenant, geo/service_area, facets, pinned/priority, etc.). The hybrid mode should match current behavior as closely as possible.
- Always filter by `tenant_id`.
- Always apply existing geo filters and any other filters currently used (facets, availability, etc.) exactly as in current logic.
- The new hybrid mode must support the existing API parameters including:
  - `query`
  - `query_type=hybrid`
  - `location`, `coords`, `distance` (for geo filtering and scoring)
  - `lang` (select the correct index: `hybrid_search_resources_{lang}`)
- Do not introduce new breaking schema requirements. Use existing indices and fields:
  - Taxonomy index: `hybrid_taxonomies`
  - Resources index: `hybrid_search_resources_{lang}`
- Ensure performance is reasonable:
  - Use `track_total_hits: false`
  - Exclude `embedding` from `_source`
  - Fetch limited candidate sets (e.g., size 100) for fusion/rerank
- Geo relevance: results closer to user coordinates should score higher (distance-based boosting), while still enforcing the same geo/service_area eligibility logic as current search.
- Reranking should be applied only to a limited candidate window (e.g., top 100–200) to keep latency low.
- Query embeddings must be generated via an **external service** using Ollama’s OpenAI-compatible API endpoint:
  - POST `<OLLAMA_BASE_URL>/embeddings`
  - Payload: `{ model: <embeddingModel>, input: <query> }`
  - Response is OpenAI-compatible: `{ data: [{ embedding: number[], index: 0 }], model: string, usage: {...} }`
  - Use `response.data.data[0].embedding` as the query vector
  - The embedding must match index dims (1024)

FORMAT:
You will implement `query_type=hybrid` in a way that follows this pipeline:

--------------------------------------------------------------------------------
A) Read current logic (MANDATORY)
--------------------------------------------------------------------------------
1) Open and review `search.service.ts` (and any related query builder modules).
2) Identify and document existing filters and ranking factors, including but not limited to:
   - tenant isolation (`tenant_id`)
   - geo eligibility logic (geo_distance OR service_area contains point; and any special casing currently present)
   - facets / structured filters (existing query params)
   - pinned / priority behavior
   - any sorting, boosting, min_score, or post-processing currently applied
3) The hybrid mode must reproduce these filters and keep behavior aligned with existing query types.
4) Only after understanding the current logic, add the new `query_type=hybrid` path.

--------------------------------------------------------------------------------
B) Phase 1a: Generate the query embedding (external service)
--------------------------------------------------------------------------------
Goal: Produce a 1024-dim embedding for the user query using Ollama's OpenAI-compatible embeddings API.

Implementation requirements:
- Use an HTTP POST request to:
  - `${ollamaBaseUrl}/embeddings`
- Use JSON body:
  - `{ model: embeddingModel, input: query }`
- Use header:
  - `Content-Type: application/json`
- Extract embedding from:
  - `response.data.data[0].embedding`
- Log useful debug information (query string and embedding length).
- If embedding fails, log and surface the error consistently with existing error handling.

Reference behavior (illustrative, not required verbatim):
/**
 * PHASE 1a: Embed the user's query using Ollama's OpenAI-compatible API
 * @param query - The user's search query
 * @returns The embedding vector for the query
 */
async embedQuery(query: string): Promise<number[]> {
  this.logger.debug(`Embedding query: "${query}" using model: ${this.embeddingModel}`);
  const response = await axios.post(
    `${this.ollamaBaseUrl}/embeddings`,
    { model: this.embeddingModel, input: query },
    { headers: { 'Content-Type': 'application/json' } },
  );
  return response.data.data[0].embedding;
}

Output:
- `query_vector: number[]` (length 1024)

--------------------------------------------------------------------------------
C) Phase 1b: Taxonomy code candidates (vector search on `hybrid_taxonomies`)
--------------------------------------------------------------------------------
Goal: Use the `query_vector` to retrieve 3–5 taxonomy code candidates. These codes will be used only as **boost signals**, not hard filters (unless the existing logic already hard-filters by taxonomy).

Index: `hybrid_taxonomies`

Mapping (for reference):
- code: keyword
- name: text
- description: text
- embedding: dense_vector (dims 1024, bbq_hnsw cosine)
- tenant_id: keyword

Query requirements:
- Filter by `tenant_id`
- Vector KNN retrieval
- Return 3–5 hits
- Minimal payload (`_source` only needs code + name optionally)

Example taxonomy query shape:
- Use KNN on `embedding`
- `k = 5`, `num_candidates = 100` (tunable)
- `track_total_hits: false`
- `_source: ["code", "name"]`

Output:
- `predicted_taxonomy_codes: string[]` (3–5 codes)
- Optionally store their rank order for weighting during boosting (code #1 strongest)

--------------------------------------------------------------------------------
D) Phase 2: Resource retrieval (hybrid `_msearch` on `hybrid_search_resources_{lang}`)
--------------------------------------------------------------------------------
Goal: Retrieve candidates using two independent retrievers:
1) Lexical BM25 query (with name booster pack on top-level `name.*` only + taxonomy code boost)
2) Vector kNN query on `embedding`

Index: `hybrid_search_resources_{lang}`

Important:
- Both retrievers MUST share the exact same filter universe (tenant + geo + existing filters). Use the filters extracted from `search.service.ts`.
- Use `_msearch` to reduce HTTP overhead (one request for both retrievals).

Base filtering (must match current logic):
- Always: `{ "term": { "tenant_id": "<tenant_id>" } }`
- Geo eligibility filter (example; replicate current logic exactly):
  {
    "bool": {
      "should": [
        { "geo_distance": { "distance": "<distance>mi", "location.point": { "lat": <lat>, "lon": <lon> } } },
        { "geo_shape": { "service_area": { "shape": { "type": "point", "coordinates": [<lon>, <lat>] }, "relation": "contains" } } }
      ],
      "minimum_should_match": 1
    }
  }
- Include any existing facet/field filters (from current logic).

--------------------------------------------------------------------------------
D1) BM25 query (Lexical)
--------------------------------------------------------------------------------
- Use `function_score` to incorporate existing ranking signals:
  - pinned boost
  - priority boost
  - (NEW) optional geo distance scoring (closer is better) if coords provided
- Name booster pack must use ONLY top-level `name.*` fields:
  - `name.lc` term
  - `name.lc` prefix
  - `name.edge` match
  - `name` match_phrase
- Generic intent search must include the existing fields used today (at least description/summary/service*/taxonomies* as currently used).
- Add taxonomy code boost using the predicted taxonomy codes (3–5). This should be a boost, not a filter.

BM25 query body template (illustrative; fill params):
- size: 100
- track_total_hits: false
- _source excludes embedding
- bool.filter: tenant + geo + current filters
- bool.should:
  - name booster pack (name.* only)
  - main multi_match intent
  - nested taxonomy code terms boost (predicted codes)
- function_score.functions:
  - pinned true => weight 2.0
  - field_value_factor priority
  - (optional) geo gauss decay on `location.point` when coords present (see Geo scoring below)
- score_mode: sum, boost_mode: sum

Taxonomy boost clause:
- Use nested query:
  {
    "nested": {
      "path": "taxonomies",
      "query": { "terms": { "taxonomies.code": ["<code1>", "<code2>", "<code3>"] } },
      "score_mode": "max",
      "boost": 6
    }
  }
- Optionally vary boost by rank: code #1 strongest, #2/#3 slightly lower.

Geo distance relevancy (optional but recommended):
- If coords are provided, add a `gauss` function:
  {
    "gauss": {
      "location.point": {
        "origin": { "lat": <lat>, "lon": <lon> },
        "scale": "<distance>mi",
        "offset": "0mi",
        "decay": 0.5
      }
    },
    "weight": 1.5
  }
- Must not violate the eligibility filter logic; it's only a scoring boost.

--------------------------------------------------------------------------------
D2) kNN query (Vector)
--------------------------------------------------------------------------------
- size: 100
- track_total_hits: false
- _source excludes embedding
- knn:
  - field: embedding
  - query_vector: (embedding of user query)
  - k: 100
  - num_candidates: 400 (tunable)
  - filter: EXACT same filter universe as BM25 (tenant + geo + current filters)

--------------------------------------------------------------------------------
E) Phase 3: Client-side fusion (RRF) + dedupe
--------------------------------------------------------------------------------
Since server-side RRF is not available on the license, implement RRF in the application:

Inputs:
- BM25 hits list (ranked)
- kNN hits list (ranked)

Compute RRF score:
- rrf_score(doc) += weight_i * (1 / (rank_constant + rank_i))
Where:
- rank_constant default: 60
- weights default: lexical 1.0, knn 0.5–1.0 (choose stable defaults; keep simple)
- rank_i is 1-based position in that list

Dedupe:
- Merge by ES `_id`.
- Prefer using BM25 document payload if present; otherwise use kNN payload.

Candidate set:
- Produce a fused ranked list of top N candidates (e.g., N=100) for reranking.

--------------------------------------------------------------------------------
F) Phase 4: Reranking (lightweight, deterministic)
--------------------------------------------------------------------------------
Goal: Improve ordering without complex ML. Keep it fast.

Rerank inputs:
- top N fused candidates (e.g., 100)
- query
- predicted taxonomy codes and their ranks
- coords/distance if provided

Rerank features (suggested, keep simple):
1) Name strength (top-level `name` only):
   - exact match on `name.lc` == q_lc => strong bonus
   - prefix match on `name.lc` startswith q_lc => bonus
   - phrase match / edge match => smaller bonus
2) Taxonomy match:
   - if resource contains predicted taxonomy code #1/#2/#3 => bonus (decreasing by rank)
3) Geo distance bonus:
   - if coords present and candidate has `location.point`, compute distance; closer => higher bonus
   - must preserve eligibility rules (already filtered), this is only ordering
4) Existing business rules:
   - pinned true => ensure it remains strongly favored (match existing behavior)
   - priority => incorporate similarly to existing logic

Output:
- final top results (e.g., 25)
- keep response format identical to existing search endpoint

--------------------------------------------------------------------------------
G) API behavior and routing
--------------------------------------------------------------------------------
- Add support for `query_type=hybrid`:
  Example:
  https://mn.gov/adresources/search?query=hero&query_label=hero&query_type=hybrid&location=Hennepin%20County%2C%20Minnesota%2C%20United%20States&coords=-93.2661%2C44.976105&distance=5
- For non-hybrid query types, keep existing behavior unchanged.
- For hybrid:
  1) compute query embedding once via `${ollamaBaseUrl}/embeddings`
  2) taxonomy knn query (hybrid_taxonomies) -> 3–5 codes
  3) resources `_msearch` (BM25 + kNN) using predicted codes as BM25 boost + existing filters
  4) client-side RRF merge + dedupe
  5) rerank top N and return final response

--------------------------------------------------------------------------------
H) Acceptance checks (what “done” means)
--------------------------------------------------------------------------------
- Hybrid mode returns results that:
  - respect all existing filters (tenant, geo/service_area eligibility, facets)
  - preserve pinned/priority behavior
  - improve relevance for both name queries (e.g., "hero", "worksource") and intent queries (e.g., "I need food stamps")
- Results are stable and performant:
  - taxonomy query + one `_msearch` (no extra ES calls beyond these)
  - `_msearch` uses size ~100 each
  - no embeddings returned in payload
  - rerank only top N fused candidates
- The code is additive: existing tests/behavior for other query types remain unchanged.