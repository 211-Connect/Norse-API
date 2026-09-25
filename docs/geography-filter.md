# Geography filter (internal routes)

ServiceNet's record selector lists, facets and (next) geography-filters
services through four internal Norse-API routes over Elasticsearch. This page
ties them together. The detail lives in two docs:

- [internal-services-search.md](internal-services-search.md): services search
  and facets (ISS-1869, PR #216)
- [internal-regions.md](internal-regions.md): Region typeahead and lookup
  (ISS-1870, PR #217)

Design: architecture-docs
[ADR 0022](https://github.com/211-Connect/ArchitectureDocs/blob/main/decisions/0022-record-selector-searches-elasticsearch-services-via-norse-api.md)
(record selector searches an ES `services` index through Norse-API) and
[ADR 0023](https://github.com/211-Connect/ArchitectureDocs/blob/main/decisions/0023-region-store-canonical-identity-seeded-from-boundary-cache.md)
(Region store). Integrations: INTEG-022, INTEG-023, INTEG-024. Data loading:
Dagster [#601](https://github.com/211-Connect/dagster-data-orchestration/pull/601)
(`services` index), [#602](https://github.com/211-Connect/dagster-data-orchestration/pull/602)
(`regions` index) and
[#604](https://github.com/211-Connect/dagster-data-orchestration/pull/604)
(publish-before-delete, orphan guards, real-ES integration suite).

## Do not deploy before ISS-1887

> **These routes have no auth (ISS-1876) and must not be reachable from the
> API gateway.** ISS-1887 blocks `/internal/*` at the gateway. Do not deploy
> a build containing them until ISS-1887 is live.
>
> Also wait for Dagster #604. Until it merges, the `services` publish is
> delete-first, and a reader sees a tenant's slice empty during every reload.

Both controllers carry `@ApiExcludeController()`, so none of the four routes
reaches `/swagger/json` or the Norse SDK. `src/common/swagger/internal-routes-exclusion.spec.ts`
mounts both modules together and checks that both are served and neither is
published. Each controller's own spec checks the same for its module.

## The four routes

Send `x-api-version: 1` on every call. No `x-tenant-id`: the writer set scopes
services, and Regions are not tenant data.

| Route | Input | Returns |
| --- | --- | --- |
| `POST /internal/services/search` | body: `resourceWriterIds` (required, max 100), `filter.taxonomyCodes`, `filter.statuses`, `text` (max 256), `cursor`, `limit` (default 50, max 200) | `{ items, total, limit, nextCursor }` |
| `POST /internal/services/facets` | body: `resourceWriterIds` (required) | `{ contributors, statuses, taxonomy }` |
| `GET /internal/regions` | query: `q` (required), `types`, `states`, `limit` (default 10, max 25) | `{ items: [{ id, type, name, state }] }` |
| `GET /internal/regions/:id` | `state:MO`, `county:29095` or `zip:64130` | `{ id, type, name, state, fips?, zip?, geometry, attribution? }` |

A services `item` is `{ id, serviceId, tenantId, resourceWriterId,
isCanonicalPublication, status, taxonomyPath, taxonomyCodes, locationTypes,
name, alternateName, description, organizationName, city, assuredDate }`.
Only these fields are read from the index (`SERVICE_LIST_SOURCE_FIELDS`), so
Dagster's `loadRunId` and the `service_area` shape are never returned.

Errors: a malformed request, cursor or Region id is 400; an unknown Region is
404; an ES timeout is 503; any other ES failure is 502.

## How a Geography filter uses them

1. The user types. ServiceNet calls `GET /internal/regions?q=…`, passing the
   tenant's states as `states` to bias the ranking.
2. The user picks a Region. ServiceNet keeps its id (`county:29095`).
3. To draw it, ServiceNet calls `GET /internal/regions/:id` for the GeoJSON
   geometry. For counties it must show the returned `attribution`.
4. To filter services, the Region ids go into the services search. **This
   clause is not built yet (ISS-1873).** Per ADR 0022, several Regions are
   OR'ed and AND'ed with every other filter. A Region matches a service when
   it intersects the service's `service_area`, and services with no area
   never match. The query should use `geo_shape` with `indexed_shape` against
   index `regions` and id = the Region id, not the fetched geometry.

## Cursor paging (services search)

- The first request has no `cursor`. Send back `nextCursor` with the **same**
  writer set, filter and text. It is null on the last page.
- A cursor encodes the last hit's `search_after` values, the sort mode and a
  fingerprint of the query. One from another query or sort mode is 400. It is
  not signed; see the detail doc for why that is safe.
- `serviceId` is the last sort key, so ties never skip or repeat a record.
- There is no point-in-time. A Dagster reload between pages shows up on the
  next page.
- `total` counts every match (`track_total_hits: true`), and there is no
  10,000-row ceiling.

Region typeahead does not page. It returns at most `limit` items.

## Ranking

**Services search.**
- Without `text`: `name.raw` ascending (missing name first), then `serviceId`.
  This matches the Mongo order.
- With `text`: `_score` descending, then `serviceId`. The text matches a
  case-insensitive contains on `name.substring` OR a `bool_prefix`
  `multi_match` (`operator: and`) over `name^3`, `alternateName`,
  `description` and `organizationName`. Score ordering is a deliberate change
  from Mongo.

**Region typeahead.**
- 1 to 5 digits: a ZIP prefix, ZIPs only, ordered by ZIP.
- Otherwise: a `bool_prefix` match on `name`, plus fixed `constant_score`
  boosts:
  - exact state code or name: +100
  - state-name prefix of 3+ characters: +10
  - type: state +3, county +2, ZIP 0
  - Region in one of `states`: +4
- Ties break on `id`. `states` is a bias, not a filter.

See [internal-regions.md](internal-regions.md) for examples and known limits
(no "Saint" → "St." synonym, no city Regions).
