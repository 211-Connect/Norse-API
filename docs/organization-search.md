# Organization Search & the Combined `/suggestion` Typeahead

This file documents three related surfaces that let a caller search for
organizations and use an organization to scope resource search: the
standalone `/organization` typeahead, the combined `/suggestion` typeahead,
and the `organization_id` filter on `/search`.

## Public endpoints

- `GET /organization` — standalone, paginated organization typeahead search.
  Unchanged by this work; documented here only for context.
- `GET /organization/:id` — organization detail lookup (Mongo-backed).
  Unrelated to this doc's scope.
- `GET /suggestion` — combined taxonomy + organization typeahead, always
  returning both in one round trip.
- `GET /search?organization_id=<id>` — scopes resource search results to a
  single organization by its stable id. Composes with any `query_type`.

All three enforce the standard `x-tenant-id` header (400 if missing/invalid)
and the `tenant_id`/`locale` query-param-mirror-must-match-header convention
used elsewhere in this service.

## `GET /organization`

Tenant-scoped, prefix-ranked organization search backed by a dedicated,
slim Elasticsearch `organizations` index (see `OrganizationService`,
`src/organization/organization.service.ts`). Query params: `query`,
`page`, `limit` (max 50). Response: `OrganizationSearchResponseDto`
(`src/organization/dto/search-organization-response.dto.ts`), with
`hits[]._source.location` using this service's `state`/`city`/`address_1`/
`postal_code` naming (matching `PhysicalAddressDto` in
`src/search/dto/search-response.dto.ts`, **not** the HSDS-style
`STATE_PROVINCE` naming used in some other DTOs).

`OrganizationService` is exported from `OrganizationModule` specifically so
`SuggestionModule` can reuse it — see below. Nothing else in this repo
imports it.

## `GET /suggestion` — combined typeahead

`/suggestion` is the combined-typeahead endpoint: it **always** returns
both taxonomy and organization matches in a single request/response round
trip. There is no opt-in/opt-out flag — that's deliberate. `GET /taxonomy`
already exists as the dedicated taxonomy-search endpoint; `/suggestion`'s
entire reason to exist is to save the frontend a second round trip by also
returning organization matches for the same `query` in the same response.
If only taxonomy results are needed, call `/taxonomy` directly instead.

Response shape (`SuggestionCombinedResponseDto`,
`src/suggestion/dto/suggestion-response.dto.ts`):

```json
{
  "taxonomies": [
    { "id": "ee9dd652-19d7-5226-bd7c-3c01f8144f2a", "code": "BH-1800", "name": "Housing" }
  ],
  "organizations": [
    { "organization_id": "o1", "name": "Alpha Org", "city": "Chicago", "state": "IL" }
  ]
}
```

Both keys are flat arrays of only the fields a typeahead dropdown needs —
neither exposes the raw Elasticsearch envelope (`took`/`timed_out`/`_score`/
pagination metadata, etc.). `taxonomies` reuses
`TaxonomyService.searchTaxonomiesV2` (the same mapping `GET /taxonomy` v2
already uses: `{ id, code, name }` per item) rather than the unmapped
`searchTaxonomies`, so there's exactly one place that knows how to flatten
a taxonomy ES hit down to typeahead-sized fields. `organizations` calls the
already-exported `OrganizationService.search()` with `page: 1, limit: 8`
(typeahead sizing, not a paginated list) using the same `query` param
already accepted for taxonomies — there is no separate organization query
param. Results are flattened to `{ organization_id, name, city, state }`
(dropping the ES `_index`/`_id`/`_score` wrapper, which isn't meaningful for
a suggestion list). Both lookups run concurrently (`Promise.all`).

**Breaking change**: prior to this, `GET /suggestion` returned the raw
Elasticsearch taxonomy response directly at the top level (no
`taxonomies`/`organizations` wrapper, full ES envelope). Every caller now
gets the wrapped, flattened `{ taxonomies: [...], organizations: [...] }`
shape unconditionally — there is no backward-compatible unwrapped mode.
This was a deliberate choice (see "Why not an `include` flag" below), not
an oversight; any existing consumer of the old shape (e.g. the generated
frontend SDK) needs to be updated alongside this change.

### Why not an `include` flag

An earlier version of this endpoint added an `include=taxonomies,organizations`
query param so the wrapped shape was opt-in, preserving the historical
unwrapped shape by default. That design was reconsidered: it meant
`/suggestion` and `/taxonomy` both independently implemented the same
taxonomy Elasticsearch query (near-duplicate code), and it made
`/suggestion`'s response shape conditional on a query param for no real
benefit — this endpoint's whole purpose is the combined result, so making
that the *only* behavior is simpler for both the implementation and any
caller. `/taxonomy` remains the place to go for taxonomy-only search.

### `/suggestion/term`

`GET /suggestion/term` (lookup taxonomy terms by exact code) also delegates
to `TaxonomyService.getTaxonomyTermsForCodes` rather than duplicating that
query — same rationale as above.

### Swagger typing

`taxonomies` items reuse `TaxonomyItemDto` (`src/taxonomy/dto/taxonomy-response.dto.ts`
— the same DTO `GET /taxonomy` v2 already returns) rather than redefining
an identical shape. `organizations` items are typed as
`OrganizationSuggestionItemDto` (`src/suggestion/dto/suggestion-response.dto.ts`)
— there's no equivalent minimal DTO to reuse from `organization/dto/`,
since `/organization` only ever returns the full ES hit shape
(`OrganizationSearchSourceDto`, with a nested `location` object and extra
fields a typeahead item doesn't need), so this is a new definition, not a
duplicate. Both give this endpoint's 200 response a real OpenAPI schema (it
was `any`-typed before this feature).

## `organization_id` filter on `/search`

`organization_id` is a top-level `/search` query param that scopes results to
the resources (service-at-locations) belonging to a single organization, by
its **stable id** — the same `organization_id` returned by `/organization`
and `/suggestion`. It is **not** a `query_type`: `query_type` selects the
matching strategy (`text`/`taxonomy`/`more_like_this`/`hybrid`), while
`organization_id` is an orthogonal scope that composes with any of them and
with every other `/search` param (`coords`/`distance`, `filters[...]`,
`sort`, `page`/`limit`, `age`).

It's implemented as one `term` clause appended to the shared
`SearchUtilsService.buildFilters(...)` array that both the standard path
(`SearchService`) and the hybrid path (`HybridSearchService`) already use:

```
{ term: { 'organization.id': <organization_id> } }
```

Because the scope lives in the filter array — not in the scoring query —
it works identically for a terminal org view (empty `query` +
`organization_id` → `match_all` scoped to the org) and for "search within an
org" (`query=housing&organization_id=<id>`), and across all query types.

### Depends on `organization.id` in the resource index

This filter matches the `organization.id` keyword field on each
resource/service-at-location document. That field is populated by the data
indexer (dagster `elasticsearch/main.py` + the resource mappings), which
stamps the org's stable id — the same id space the `organizations` index
publishes as `organization_id`. See the companion change
`feat(elasticsearch): stamp organization.id onto resource docs`.

Rollout ordering: the indexer change must land and republish **before**
this filter is relied on in production, otherwise `organization.id` is
absent on existing docs and the filter matches nothing until the republish
completes. The param itself is safe to ship early — omitting or passing an
`organization_id` that no document carries simply returns no results for
that scope, and all other search behavior is unchanged.

### Why id, not name

An earlier iteration matched on the organization **name** (`term` on
`organization.name.lc` OR `match_phrase` on the resource `name`) because the
resource index did not carry the org id. Name matching is unsafe: names are
**non-unique** (two orgs in a tenant can share a name — exactly the case the
typeahead's city/state badge disambiguates, then a name filter re-merges),
**mutable** (a rename silently breaks the scope), and the `match_phrase`
fallback leaked (a resource whose *own* title contained the phrase matched
even under a different provider). Stamping the id onto the resource doc
removes all three, so the filter is a precise `term` on a stable key.
