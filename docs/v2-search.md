# v2 search (`GET /v2/search`)

Hybrid search plus classification and the clarification rules engine ([v2-rules-engine.md](v2-rules-engine.md)). Ticket: ISS-2499. **The request and response shapes are a draft until the v2 ADR (ISS-2493).**

## Routing and flag

- `GET /v2/search` reaches `V2SearchController`; the path picks the version (ISS-2496). `x-api-version: 2` is a 400 on every path, so `/search` with that header no longer reaches v2. `GET /search` and `GET /v1/search` stay v1, unchanged.
- `POST /v2/search` takes the v1 POST body (`geometry`) and the same `Content-Type: application/json` check; the body goes to hybrid search unchanged.
- **Tenant and language come from the URL only (ADR 0039 Decision 34).** Every v2 search request (`GET` and `POST /v2/search`) needs `tenant_id` and `locale` in the query string. v2 does not read `x-tenant-id` or `accept-language`: on v2 requests `TenantMiddleware` and `LocaleMiddleware` copy the URL values over them. Why: a copied URL alone must reproduce the search, and the CDN keys by URL and ignores `Vary` (on 2026-11-17 a second tenant got another tenant's cached body). A missing or empty value is a `400` that names the param (`V2UrlMirrorsGuard`); an invalid `tenant_id` or a `locale` that is not an exact supported code is a `400` too. Example: `GET /v2/search?query=rent&tenant_id=<tenant uuid>&locale=en`. v1 `/search` does not need them.
- `V2_SEARCH_ENABLED` must be exactly `true`. Anything else answers `404` before validation (`V2SearchEnabledGuard`).
- `ML_BROKER_EMERGENCY_ONLY_SUPPORTED`: exact `true` means ml-broker accepts `emergency_only` (ml-broker PR #20). Then a tenant with AI classification off sends `emergency_only: true`: ml-broker skips the needs model and answers `needs.scores: []`, `urgency: null`. The client accepts that shape only when it sent the field, and maps it to need status `ok` with no scores and no urgency (the AI-off "no guess" state). Default off: an older ml-broker may reject the field. The route always calls ml-broker.
- `V2_CLASSIFY_TIMEOUT_MS`: timeout of the classify call, integer ms, default 1000 (Lucas 2026-11-13: ml-broker is slow; was 300).

## Pipeline (`V2SearchService.search`)

1. Flag check (guard, above), then the query DTO (`V2SearchQueryDto`: the v1 search params without `query_type`, plus `needs`, `passed_needs`, `urgency`, `clarify`). An unknown code in `needs` or `passed_needs`, or `N-X` in `needs`, gives `400`; the message names each unknown code.
2. Classify: ml-broker `search-classification/predict`, once, only when `query` is a string with text after trim. A string array or an AND/OR object has no text for the model (`hasText` false). A failure or timeout never fails the request: signals become `status: 'error'` and `model_version` is `null`. No text: signals are `{ needs: { status: 'ok', scores: {} }, emergency: null }`.
3. `decide(...)` with an empty tenant context.
4. `boostNeeds` become `NeedScore[]` (tier from the SUNE code; score 1 for a caller need, else the classify score).
5. `HybridSearchService.searchHybrid` with `query_type: 'hybrid'` and `rankingVersion: 'v2'`.
6. `finalize(...)` with the hits total and the per-need counts (`by_code`). `by_code` is `null` (not counted) when `clarify=never`, no codes were asked, or the count failed; every option is then kept. `strongTextMatch: false` is still a placeholder.
7. Response: the v1 hybrid response plus `intent`, `clarification` (snake_case keys), `model_version`, `rules_version`. No top-level `emergency` block (ADR 0039 Decision 54): the emergency is only the emergency question in `clarification` (`importance` `critical` = popup band, `high` = soft band; caller `urgency=U-0` gives a `critical` one with hotlines and no options). Each option is `{label, parameter, value, results_count?}`.

Usage metric: one `norse_search_requests_total` count per request with `search_type="v2"`.

## Left out of this slice

- A `needs=` hard filter: `needs=` never filters. A caller need makes a block and boosts; a model guess only boosts (ADR 0039 Decision 18).
- `strongTextMatch`: no retrieval signal yet.
- Tenant context (`topAreas`, `hotlines`).
- The `region` and `model_version` params.

## `taxonomy` (ISS-2612, ADR 0039 Decision 5)

`taxonomy` is the v1 param (comma list or array, de-duplicated). It reaches `searchHybrid` with the other v1 fields and becomes the hybrid hard scope on `taxonomies.code` (a `keyword` field in `hybrid_search_resources_*`). The scope filters the results and the per-need counts. With no `query` text, classify does not run (Decision 14), no embedding runs, and `needs=` still order (blocks) and boost; they never filter (Decision 18).

**A code matches itself and its child codes (v2 only).** `BD-1800` matches `BD-1800`, `BD-1800.2000` and `BD-1800.8200-250`, and never `BD-18000`. A child starts with `.` or `-` after the parent code, so each code becomes a `bool.should` of an exact `term` plus `prefix` queries on `<code>.` and `<code>-`. Several codes stay an OR. This holds for the results and for the per-need counts. v1 `query_type=hybrid&taxonomy=` stays exact. v1 `query_type=taxonomy` (classic index) is unchanged. A prefix query on a `keyword` field walks the sorted term list from the prefix, so it is cheap for a narrow code; the cost is not measured.

`intent.taxonomy` echoes the codes the request sent, as sent (not expanded to children), each as `{value, source: "caller"}`. It is absent when the request sent none.
- Response caching: no CDN cache decorator. The rule is the rules engine's internal `decision.cacheable` (band none and no emergency question, ADR 0039 Decision 28); no `Cache-Control` header is written from it yet (numbers open, ADR 0039 Question 11).

## Typo clauses and the rarity gate (ISS-2793)

The keyword list has two typo-tolerant clauses: one on the general recall fields and one on taxonomy name and description. They cost the most of any clause in the list.

The rule: the keyword list leaves both clauses out when every content word of the search text matches MORE THAN 5 tenant documents (`TYPO_GATE_MAX_DOCS` in `src/search/internal/text-matching/fuzzy-match.ts`). A word with that many documents is spelled correctly. A misspelled word matches almost nothing.

The count comes from the word-rarity request that already runs for every v2 search. It adds one bucket per word (`c{i}`) over the same fields as the recall clause. It is cached per word with the idf (key prefix `search:rarity4:`). No extra Elasticsearch request.

The typo clauses stay in when:

- the rarity lookup failed (the result is null);
- the search text has no content words;
- the search text has 12 or more content words (the word list may be cut, so some words are not counted).

They also stay in when at least one content word has 5 documents or fewer, including 0. v1 search is not changed.

The span `hybrid.word_rarity` carries the boolean attribute `hybrid.typo_clauses`.

Measured on 2026-11-17: on 620 real search texts the gate removes the typo clauses on 59% and cuts the keyword list p50 from 141 ms to 81 ms. 0.8% of 600 synthetic typos are missed. nDCG@10 on 134 graded queries goes from 0.697 to 0.695.

## Tests

`npx jest src/v2/search`; `npx jest --config ./test/jest-e2e.json test/v2-search-versioning.e2e-spec.ts`.
