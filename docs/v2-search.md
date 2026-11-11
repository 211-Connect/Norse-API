# v2 search (`GET /v2/search`)

Hybrid search plus classification and the clarification rules engine ([v2-rules-engine.md](v2-rules-engine.md)). Ticket: ISS-2499. **The request and response shapes are a draft until the v2 ADR (ISS-2493).**

## Routing and flag

- `GET /v2/search` (the `/v2/` path selects API version 2, no header needed) and `GET /search` with `x-api-version: 2` both reach `V2SearchController`. `GET /search` without the header stays v1, unchanged.
- `POST /v2/search` and `POST /search` with `x-api-version: 2` take the v1 POST body (`geometry`) and the same `Content-Type: application/json` check; the body goes to hybrid search unchanged.
- `V2_SEARCH_ENABLED` must be exactly `true`. Anything else answers `404` before validation (`V2SearchEnabledGuard`).
- `V2_CLASSIFY_TIMEOUT_MS`: timeout of the classify call, integer ms, default 1000.

## Pipeline (`V2SearchService.search`)

1. Flag check (guard, above), then the query DTO (`V2SearchQueryDto`: the v1 search params without `query_type`, plus `needs`, `passed_needs`, `urgency`, `clarify`).
2. Classify: ml-broker `search-classification/predict`, once, only when `query` is a string with text after trim. A string array or an AND/OR object has no text for the model (`hasText` false). A failure or timeout never fails the request: signals become `status: 'error'` and `model_version` is `null`. No text: signals are `{ needs: { status: 'ok', scores: {} }, emergency: null }`.
3. `decide(...)` with an empty tenant context.
4. `boostNeeds` become `NeedScore[]` (tier from the SUNE code; score 1 for a caller need, else the classify score).
5. `HybridSearchService.searchHybrid` with `query_type: 'hybrid'` and `rankingVersion: 'v2'`.
6. `finalize(...)` with the hits total. Per-code counts (`byCode: {}`) and `strongTextMatch: false` are placeholders.
7. Response: the v1 hybrid response plus `intent`, `clarification` (snake_case keys), `emergency`, `model_version`, `rules_version`.

Usage metric: one `norse_search_requests_total` count per request with `search_type="v2"`.

## Left out of this slice

- The `needs=` hard filter (needs only boost).
- Per-code result counts: the stored need tags (dagster PR #780) are not available yet.
- `strongTextMatch`: no retrieval signal yet.
- Tenant context (`topAreas`, `hotlines`).
- The `taxonomy`, `region` and `model_version` params.
- Response caching: no CDN cache decorator, because a response with emergency status error must not be cached and that rule is not written yet.

## Tests

`npx jest src/v2/search`; `npx jest --config ./test/jest-e2e.json test/v2-search-versioning.e2e-spec.ts`.
