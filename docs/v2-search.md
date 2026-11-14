# v2 search (`GET /v2/search`)

Hybrid search plus classification and the clarification rules engine ([v2-rules-engine.md](v2-rules-engine.md)). Ticket: ISS-2499. **The request and response shapes are a draft until the v2 ADR (ISS-2493).**

## Routing and flag

- `GET /v2/search` (the `/v2/` path selects API version 2, no header needed) and `GET /search` with `x-api-version: 2` both reach `V2SearchController`. `GET /search` without the header stays v1, unchanged.
- `POST /v2/search` and `POST /search` with `x-api-version: 2` take the v1 POST body (`geometry`) and the same `Content-Type: application/json` check; the body goes to hybrid search unchanged.
- `V2_SEARCH_ENABLED` must be exactly `true`. Anything else answers `404` before validation (`V2SearchEnabledGuard`).
- `V2_CLASSIFY_TIMEOUT_MS`: timeout of the classify call, integer ms, default 300. The value is a start value; Lucas decides 150 or 300 ms after a measurement on dev (ADR 0039 open question 8).

## Pipeline (`V2SearchService.search`)

1. Flag check (guard, above), then the query DTO (`V2SearchQueryDto`: the v1 search params without `query_type`, plus `needs`, `passed_needs`, `urgency`, `clarify`). An unknown code in `needs` or `passed_needs`, or `N-X` in `needs`, gives `400`; the message names each unknown code.
2. Classify: ml-broker `search-classification/predict`, once, only when `query` is a string with text after trim. A string array or an AND/OR object has no text for the model (`hasText` false). A failure or timeout never fails the request: signals become `status: 'error'` and `model_version` is `null`. No text: signals are `{ needs: { status: 'ok', scores: {} }, emergency: null }`.
3. `decide(...)` with an empty tenant context.
4. `boostNeeds` become `NeedScore[]` (tier from the SUNE code; score 1 for a caller need, else the classify score).
5. `HybridSearchService.searchHybrid` with `query_type: 'hybrid'` and `rankingVersion: 'v2'`.
6. `finalize(...)` with the hits total. Per-code counts (`byCode: {}`) and `strongTextMatch: false` are placeholders.
7. Response: the v1 hybrid response plus `intent`, `clarification` (snake_case keys), `model_version`, `rules_version`. No top-level `emergency` block (ADR 0039 Decision 54): the emergency is only the emergency question in `clarification` (`level` red = popup, orange = soft card; caller `urgency=U-0` gives a red one with hotlines and no options). Each option is `{label, parameter, value, results_count?}`.

Usage metric: one `norse_search_requests_total` count per request with `search_type="v2"`.

## Left out of this slice

- The `needs=` hard filter (needs only boost).
- Per-code result counts: the stored need tags (dagster PR #780) are not available yet.
- `strongTextMatch`: no retrieval signal yet.
- Tenant context (`topAreas`, `hotlines`).
- The `taxonomy`, `region` and `model_version` params.
- Response caching: no CDN cache decorator. The rule is the rules engine's internal `decision.cacheable` (band none and no emergency question, ADR 0039 Decision 28); no `Cache-Control` header is written from it yet (numbers open, ADR 0039 Question 11).

## Tests

`npx jest src/v2/search`; `npx jest --config ./test/jest-e2e.json test/v2-search-versioning.e2e-spec.ts`.
