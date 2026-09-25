# Geography filter (internal routes)

ServiceNet's record selector lists, facets and geography-filters
services through four internal Norse-API routes over Elasticsearch. This page
ties them together. The detail lives in two docs:

- [internal-services-search.md](internal-services-search.md): services search
  and facets (ISS-1869, PR #216)
- [internal-regions.md](internal-regions.md): Region typeahead and lookup
  (ISS-1870, PR #217)

Design: architecture-docs
[ADR 0023](https://github.com/211-Connect/ArchitectureDocs/blob/main/decisions/0023-record-selector-searches-elasticsearch-services-via-norse-api.md)
(record selector searches an ES `services` index through Norse-API) and
[ADR 0024](https://github.com/211-Connect/ArchitectureDocs/blob/main/decisions/0024-region-store-canonical-identity-seeded-from-boundary-cache.md)
(Region store). Both ADRs are in ArchitectureDocs
[PR #31](https://github.com/211-Connect/ArchitectureDocs/pull/31), so the
links resolve once it merges. Integrations: INTEG-022, INTEG-023, INTEG-024. Data loading:
Dagster [#601](https://github.com/211-Connect/dagster-data-orchestration/pull/601)
(`services` index), [#602](https://github.com/211-Connect/dagster-data-orchestration/pull/602)
(`regions` index) and
[#604](https://github.com/211-Connect/dagster-data-orchestration/pull/604)
(publish-before-delete, orphan guards, real-ES integration suite).

## Auth: the internal key, not a tenant

The four routes are not tenant-scoped: the writer set scopes services, and
Regions are not tenant data. They are guarded by the internal key instead, on
every path:

- **Internal key, always.** Both controllers carry
  `@UseGuards(InternalApiGuard)`: every call sends `x-internal-api-key`, equal
  to Norse-API's `INTERNAL_API_KEY`. A missing or wrong key is `401`. So is
  every call when `INTERNAL_API_KEY` is unset or empty: the guard fails closed.
  The comparison is constant-time.
- **Through the gateway.** A gateway key holding `norse-api.invoke`, plus the
  internal key. No `x-tenant-id`: both controllers carry `@NotTenantScoped()`,
  which exempts them from `TenantScopeGuard` and from nothing else.
  `GatewayIdentityGuard` and `GatewayPermissionsGuard` still run.
- **Direct.** `api.c211.io` and `api-dev.c211.io` (App Platform, no gateway)
  reach the routes on the legacy path, where the internal key is the only
  protection.

ISS-1887 (block `/internal/*` at the gateway) is now defence in depth, not a
precondition for deploying these routes.

`src/auth/gateway/internal-geography-routes.spec.ts` mounts the two modules
behind the global gateway guards and checks each route in gateway and legacy
mode: the key passes without `x-tenant-id`, a missing or wrong key is `401`,
an unset or empty `INTERNAL_API_KEY` rejects everything, and an existing
tenant-scoped route still needs a tenant.

ServiceNet sends the same value as `NORSE_INTERNAL_API_KEY`.

> **Do not deploy before Dagster #604.** Until it merges, the `services`
> publish is delete-first, and a reader sees a tenant's slice empty during
> every reload.

Both controllers carry `@ApiExcludeController()`, so none of the four routes
reaches `/swagger/json` or the Norse SDK. `src/common/swagger/internal-routes-exclusion.spec.ts`
mounts both modules together and checks that both are served and neither is
published. Each controller's own spec checks the same for its module.

## The four routes

Send `x-api-version: 1` and `x-internal-api-key` on every call. No
`x-tenant-id`: the writer set scopes services, and Regions are not tenant data.

| Route | Input | Returns |
| --- | --- | --- |
| `POST /internal/services/search` | body: `resourceWriterIds` (required, max 100), `filter.taxonomyCodes`, `filter.statuses`, `filter.geography.regionIds` and `filter.geography.points` (1 to 20 together), `filter.virtual`, `text` (max 256), `cursor`, `limit` (default 50, max 200) | `{ items, total, limit, nextCursor }` |
| `POST /internal/services/facets` | body: `resourceWriterIds` (required), `filter.geography.regionIds`, `filter.geography.points`, `filter.virtual` | `{ contributors, statuses, taxonomy }` |
| `GET /internal/regions` | query: `q` (required), `types`, `states`, `limit` (default 10, max 25) | `{ items: [{ id, type, name, state }] }` |
| `GET /internal/regions/:id` | `state:MO`, `county:29095` or `zip:64130` | `{ id, type, name, state, fips?, zip?, geometry, attribution? }` |

A services `item` is `{ id, serviceId, tenantId, resourceWriterId,
isCanonicalPublication, status, taxonomyPath, taxonomyCodes, locationTypes,
name, alternateName, description, organizationName, city, assuredDate }`.
Only these fields are read from the index (`SERVICE_LIST_SOURCE_FIELDS`), so
Dagster's `loadRunId` and the `service_area` shape are never returned.

## Canonical publications only

Every services read excludes `isCanonicalPublication: false` (as Mongo's
`$ne: false`); a document without the flag is canonical. This relies on
Dagster writing `isCanonicalPublication=false` on every borrowed copy: the
UWGKC reader, for example, publishes St. Louis records under its own tenant
as non-canonical. A borrowed copy loaded without the flag would be listed and
counted twice. The live parity run confirmed the rule holds: for writer
`5334599c-1be1-4e55-bf86-1f19d56e9da4` the index held 27,691 documents under
each of two tenants, and services search returned 27,691 distinct services,
equal to Mongo.

## Errors

A malformed request, cursor or Region id is 400; an unknown Region is
404 on `GET /internal/regions/:id` and 400 in a services `filter.geography`; an ES timeout is 503; any other ES failure is 502.

## How a Geography filter uses them

1. The user types. ServiceNet calls `GET /internal/regions?q=…`, passing the
   tenant's states as `states` to bias the ranking.
2. The user picks a Region. ServiceNet keeps its id (`county:29095`).
3. To draw it, ServiceNet calls `GET /internal/regions/:id` for the GeoJSON
   geometry. For counties it must show the returned `attribution`.
4. To filter services, ServiceNet sends the Region ids as
   `filter.geography.regionIds` on the services search **and** facets
   (ISS-1873). See [Geography and virtual clauses](#geography-and-virtual-clauses).

## Geography and virtual clauses

ISS-1873 (geography) and ISS-1874 (virtual) add two optional fields to
`filter` on both services routes:

```json
POST /internal/services/search
{
  "resourceWriterIds": ["5334599c-1be1-4e55-bf86-1f19d56e9da4"],
  "filter": {
    "taxonomyCodes": ["BD-1800"],
    "statuses": ["active"],
    "geography": { "regionIds": ["county:29510", "zip:63110"] },
    "virtual": "exclude"
  },
  "text": "food",
  "limit": 50
}
```

```json
POST /internal/services/facets
{
  "resourceWriterIds": ["5334599c-1be1-4e55-bf86-1f19d56e9da4"],
  "filter": {
    "geography": { "regionIds": ["state:MO"] },
    "virtual": "only"
  }
}
```

**Geography.**
- `regionIds`: 1 to 20 Region ids, each `state:XX`, `county:NNNNN` or
  `zip:NNNNN` (the pattern `GET /internal/regions/:id` validates). A
  repeated id is dropped.
- Regions are OR'ed, and the clause is AND'ed with every other filter
  (ADR 0023). The clause is a `bool.should` of one `geo_shape` per Region on
  `service_area`, `indexed_shape: { index: "regions", id, path: "geometry" }`,
  `relation: "intersects"`, `minimum_should_match: 1`. ES reads each shape
  from the index, so no geometry crosses the wire.
- `points` (ISS-1897, ADR 0025): each `{ lat, lng, radiusMiles }`, with
  `lat` in ±90, `lng` in ±180 and `radiusMiles` from 0.1 to 100. A point is a
  query-time `circle` on `service_area` (`coordinates: [lng, lat]`,
  `radius: "<r>mi"`, `relation: "intersects"`), OR'ed with the Regions in the
  same `bool.should`. A repeated point is dropped. Regions and points count
  together toward the 20; `geography` with none, or more than 20, is 400. A
  points-only clause skips the Region existence check.
- `intersects` counts border contact (a v1 decision). A service whose area
  only touches a Region's edge matches. See
  [Known behaviour: border contact](#known-behaviour-border-contact).
- **A Virtual Service with no Service Area serves every Region** (ADR 0025,
  ISS-1895). The `bool.should` carries one more branch: `locationTypes`
  contains `virtual` and `service_area` does not exist. A physical-only
  service without a `service_area` still never matches.
- With `virtual: "exclude"` that branch is left out, so a service needs a
  physical location **and** a `service_area` that overlaps a Region.
- **Unknown Region id: 400.** Before searching, one `mget` on `regions`
  (`_source: false`) checks every id, and the 400 lists each unknown one:
  `Unknown Region id(s): zip:00000`. ES itself answers an `indexed_shape`
  with a missing id as a 400 `illegal_argument_exception` ("Shape with ID
  [zip:00000] not found"). That error is also mapped to the same 400, in case
  a Region disappears between the check and the search. It is never a 502.

**Virtual** (`locationTypes`):

| `virtual` | Matches |
| --- | --- |
| `all` (default) | no clause |
| `only` | some location is virtual (`locationTypes` contains `virtual`) |
| `exclude` | some location is physical (`locationTypes` contains `physical`) |

A service with both kinds of location appears under `only` **and** under
`exclude`. A service with neither (postal only, or no locations) appears only
under `all`.

**Facets** take `geography` and `virtual` but not `taxonomyCodes` or
`statuses`, which are the options being counted. Send the same geography and
virtual mode as the list, so each count matches what the list would show.

**Cursors.** The fingerprint covers `regionIds`, `points` and `virtual`. A cursor from
one geography or virtual mode is 400 against another. `virtual: "all"` and no
`virtual` are the same query, and so is the same set of Region ids in another
order.

## Known behaviour: border contact

`relation: intersects` is the accepted v1 rule: a service whose
`service_area` only touches a Region's edge matches that Region. Measured on
production for tenant UWGSL211:

| Region | Matches | Border-only |
| --- | --- | --- |
| `zip:63110` | 7,190 | 202 (2.8%) |
| `county:29510` (St. Louis City) | 9,413 | 1,486 (15.8%) |
| `state:KS` | 3,912 | 3,706 (94.7%), only touching the MO/KS line |

Every St. Louis City match is also a St. Louis County (`county:29189`)
match: City OR County returns the County's 11,179. For a Missouri tenant,
most `state:KS` matches are Missouri services whose area reaches the state
line.

If this confuses users, the known remedy is an interior-shape variant: a
second field on `regions` holding each geometry shrunk by about 100 m,
matched instead of `geometry`. It is not built.

## Cursor paging (services search)

- The first request has no `cursor`. Send back `nextCursor` with the **same**
  writer set, filter and text. It is null on the last page.
- A cursor encodes the last hit's `search_after` values, the sort mode and a
  fingerprint of the query. One from another query or sort mode is 400. It is
  not signed; see the detail doc for why that is safe.
- The fingerprint covers every filter field; the type that builds it fails to
  compile when a field is added without it. `resourceWriterIds`,
  `taxonomyCodes`, `statuses` and `regionIds` are sets: sorted and
  de-duplicated first, so reordering one gives the same fingerprint and
  `preference`.
- `serviceId` is the last sort key, and every request of one query (first
  page included) sends the same ES `preference`, derived from the query
  fingerprint. Both are needed for pages not to skip or repeat a record:
  primary and replica copies score text differently (different deleted-doc
  counts), so without the preference score-ordered pages can come from
  different copies. See the detail doc.
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
- 1 to 5 digits: a ZIP prefix, ZIPs only, ordered by ZIP. `states` is
  ignored on this path: no boost applies, ZIP order is the whole ranking.
- Otherwise: a `bool_prefix` match on `name`, plus fixed `constant_score`
  boosts:
  - exact state code or name: +100
  - state-name prefix of 3+ characters: +10
  - type: state +3, county +2, ZIP 0
  - Region in one of `states`: +4
- Ties break on `id`. `states` is a bias, not a filter.

See [internal-regions.md](internal-regions.md) for examples and known limits
(no "Saint" → "St." synonym, no city Regions).

## Live test against a real cluster

`src/live/geography.live.spec.ts` runs the four routes against a real
Elasticsearch, production included. It is skipped unless `NORSE_LIVE_ES=1`,
so `npm test` never touches a cluster.

It mounts both internal modules in a Nest app with the production
`ValidationPipe` and versioning, and swaps in only the ES client.

- Scenario 2 walks every text query twice, in full. It fails on a duplicate,
  on a record missing against `total`, on pages that differ between the two
  walks, or on a page sent without the query's single `preference`.
- Scenario 6 measures raw `geo_shape` `indexed_shape` clauses, including how
  many matches only touch a Region's edge (Q53).
- Scenario 8 drives the geography and virtual filters through the routes. It
  checks each total against a direct count, facet sums against the list, a
  paged walk under a Region, and the 400s for malformed and unknown ids.

**It is read-only by construction.** The client comes from
`src/common/testing/read-only-elasticsearch.ts`:

- Only GET and HEAD, and POST to a path ending in `_search`, `_count` or
  `_mget` (the Region existence check), are allowed. Anything else throws `ReadOnlyViolationError` before it is sent:
  `_doc` writes, `_bulk`, `_update_by_query`, `_delete_by_query`, `_reindex`,
  index, alias, settings, mapping, pipeline and script changes, scroll and PIT.
- The check runs twice: in the Transport, then in the Connection on the exact
  method and path. Either one alone blocks a write.
- The client stops at a request budget (`LIVE_MAX_REQUESTS`, default 1,500).
- `read-only-elasticsearch.spec.ts` proves it, and runs in plain `npm test`.
  It calls `index`, `bulk`, `deleteByQuery`, `indices.create` and the other
  writes against a recording connection, and asserts each is refused with
  nothing sent.

Mongo parity is optional (`NORSE_LIVE_MONGO=1`). It goes through
`ReadOnlyCollection`, which offers only `countDocuments`, a projected `find`,
and `aggregate` limited to `$match`, `$group`, `$project` and `$count`.

To run it, port-forward the cluster and source the agent credentials in the
same shell:

```bash
kubectl --context do-sfo2-dagster-self-hosted -n elasticsearch \
  port-forward svc/cluster-es-http 9200:9200 &
set -a; source ../.env.agent; set +a   # ELASTICSEARCH_HOST, ELASTICSEARCH_API_KEY, MONGODB_CONNECTION_STRING
NORSE_LIVE_ES=1 NORSE_LIVE_MONGO=1 npx jest src/live/geography.live --runInBand
```

- A run makes about 650 ES requests, at concurrency 4 or less, with a pause
  between pages. The JSON report goes to `LIVE_REPORT_PATH` (default:
  `$TMPDIR/norse-geography-live-report.json`).
- Other knobs: `LIVE_TENANT_ID` (default UWGSL211), `LIVE_PAGE_DELAY_MS`,
  `LIVE_CONCURRENCY` (max 4) and `LIVE_LATENCY_SAMPLES` (max 30).
- **Don't run it during a Dagster reload.** Until Dagster #604 merges, a
  reload deletes a tenant's slice and refills it over several minutes. The
  full walk counts the slice before and after and fails if it moved.
