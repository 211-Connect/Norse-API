# Organization Search & the Combined `/suggestion` Typeahead

This file documents three related surfaces that let a caller search for
organizations and use an organization to scope resource search: the
standalone `/organization` typeahead, the combined `/suggestion` typeahead,
and `query_type=organization` on `/search`.

## Public endpoints

- `GET /organization` — standalone, paginated organization typeahead search.
  Unchanged by this work; documented here only for context.
- `GET /organization/:id` — organization detail lookup (Mongo-backed).
  Unrelated to this doc's scope.
- `GET /suggestion` — combined taxonomy + organization typeahead, always
  returning both in one round trip.
- `GET /search?query_type=organization&query=<name>` — scopes resource
  search results to a single organization by exact name match.

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

## `query_type=organization` on `/search`

Adds `organization` as a valid `query_type` value (alongside `text`,
`taxonomy`, `more_like_this`, `hybrid`). Composes with every other `/search`
param — `location`/`coords`/`distance`, `filters[...]`, `sort`, `page`/
`limit`, `age` — exactly like `taxonomy` does today, because it's
implemented as one more entry appended to the same shared
`SearchUtilsService.buildFilters(...)` filter array that every query type
already uses (`SearchService.getQueryObject`, `case 'organization'`).

### Why this matches by name, not by id

The task that produced this endpoint originally assumed `query` would be an
`organization_id` (a stable id looked up via `/organization` or
`/suggestion`). **That assumption turned out to be wrong for this codebase**:

- `organization_id` does not exist anywhere on the resource/service-at-location
  Elasticsearch index's queryable surface (confirmed: it's absent from
  `SearchUtilsService.FIELDS_TO_QUERY`, from every sort/filter field this
  service builds, and from `OrganizationDto`'s typed `_source` fields in
  `src/search/dto/search-response.dto.ts`).
- This repo owns **no** Elasticsearch mapping, index-creation, or
  reindex/backfill tooling at all — the resource index's mapping is owned by
  an external indexer service outside this workspace. Adding
  `organization_id` to that mapping and backfilling existing documents is
  not something Norse API can do; it would require a change from whatever
  team/service owns that indexer.

Rather than block this feature on that external, out-of-repo dependency,
`query_type=organization` instead treats `query` as the organization's
**name** (a plain string, as returned by `/organization`'s or
`/suggestion`'s `name` field) and uses a **compound filter** that matches
if **either** condition is true (OR):

- `term` on `organization.name.lc` — exact, case-insensitive match against
  the resource's denormalized organization name field. This field exists on
  the resource index (confirmed by its use in `hybrid-search.service.ts`'s
  org-name-tier sorting), but is frequently **null** (the external indexer
  often omits it).
- `match_phrase` on `name` — full-text phrase match against the resource
  display name. Resource names typically include the organization name as
  part of a composite title, e.g. `"Congregate Meals/Nutrition Sites |
  Hanul Family Alliance - Lake County Office"` contains the org name
  `"Hanul Family Alliance"` as a searchable phrase.

Both conditions are wrapped in a `bool.should` with `minimum_should_match: 1`
and pushed as one filter clause into the shared filter array, so they compose
normally with every other `/search` param. This needs **no Elasticsearch
mapping change and no backfill/reindex** — it works against fields that are
already indexed.

`query` must be a plain string when `query_type=organization`; an array or
a nested AND/OR object is rejected with `400` (`SearchService.searchResources`,
early validation before dispatching to `getQueryObject`). An empty/whitespace
name is also rejected with `400`.

### Known limitation

Because this filters by name text rather than a stable id, **two
organizations in the same tenant with the identical name are
indistinguishable** to this filter — both would match. This directly
undercuts the disambiguation UX that motivated showing city/state in an
organization typeahead dropdown in the first place (names can collide,
which is exactly why the dropdown shows a location). This is a known,
accepted trade-off, not an oversight: without `organization_id` on the
resource index, an id-based exact filter isn't achievable from within this
repo. If a future need requires disambiguating same-named organizations in
`/search`, that would require the external indexer team to add
`organization_id` to the resource/service-at-location index mapping and
backfill existing documents — out of scope for Norse API alone.

## Written confirmation (mapping/backfill)

`organization_id` was **not** added to the resource/service-at-location
Elasticsearch index mapping, and **no backfill/reindex was performed or is
required** for this feature. `query_type=organization` relies on two
pre-existing fields: `organization.name.lc` (a keyword subfield, often
null) and `name` (the resource display name, which tends to contain the
organization name).
