# Geography filter (internal routes)

ServiceNet's record selector lists, facets and (next) geography-filters
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
   clause is not built yet (ISS-1873).** Per ADR 0023, several Regions are
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

## Live test against a real cluster

`src/live/geography.live.spec.ts` runs the four routes against a real
Elasticsearch, production included. It is skipped unless `NORSE_LIVE_ES=1`,
so `npm test` never touches a cluster.

It mounts both internal modules in a Nest app with the production
`ValidationPipe` and versioning, and swaps in only the ES client. The
geography scenario previews ISS-1873: it builds `buildServiceFilter` plus a
`geo_shape` `indexed_shape` clause, and measures how many matches only touch
a Region's edge (Q53).

**It is read-only by construction.** The client comes from
`src/common/testing/read-only-elasticsearch.ts`:

- Only GET and HEAD, and POST to a path ending in `_search` or `_count`, are
  allowed. Anything else throws `ReadOnlyViolationError` before it is sent:
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
