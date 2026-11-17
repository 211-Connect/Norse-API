# Internal Region typeahead and lookup

ServiceNet's Geography filter turns typed text into a Region and a Region into
its boundary through two internal routes over the Elasticsearch **alias
`regions`** (currently `regions_v1`). Dagster loads the index once from the
Region seed (Dagster PR #602, INTEG-023). See architecture-docs ADR 0024 (ArchitectureDocs PR #31) and
INTEG-024.

| Route                                | Query                                                           | Returns                                                                             |
| ------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `GET /internal/regions`              | `q` (required), `types`, `states`, `limit` (default 10, max 25) | `{ items: [{ id, type, name, state, centroid? }] }`                                 |
| `GET /internal/regions/:id`          | —                                                               | `{ id, type, name, state, centroid?, fips?, zip?, geometry, attribution? }`         |
| `GET /internal/regions/places`       | `state`, `limit` (default 25, max 100), `cursor`                | `{ items: [{ id, name, state, slug, place_type }], next_cursor }`                   |
| `GET /internal/regions/places/:slug` | —                                                               | `{ id, type, name, state, fips, slug, lsad, place_type, centroid, bbox, geometry }` |

`centroid` is `{ lat, lng }` from the seed's `[lon, lat]`, present for counties and ZIPs (the seed has none for states). ServiceNet biases address search toward it (ISS-1875).

Send `x-api-version: 1`, as for every versioned route, and
`x-internal-api-key`. No `x-tenant-id`: Regions are not tenant data.

## Status

- **Unpublished.** `@ApiExcludeController()` keeps these routes out of
  `/swagger/json`, so the Norse SDK never sees them.
  `region.controller.spec.ts` checks the generated document.
- **Internal key, not tenant scope.** Not tenant-scoped
  (`@NotTenantScoped()`). Every call needs `x-internal-api-key` equal to
  `INTERNAL_API_KEY`, on the gateway path (a key with `norse-api.invoke`) and
  on `api.c211.io` / `api-dev.c211.io` alike; an unset key rejects
  everything. ISS-1887 is defence in depth. See
  [geography-filter.md](geography-filter.md#auth-the-internal-key-not-a-tenant).

## Internal OpenAPI contract

Generate the Region OpenAPI 3.0 JSON from the controller and DTO annotations:

```sh
npm run --silent openapi:internal-regions > internal-regions-openapi.json
```

Generation runs offline and does not connect to Elasticsearch or start an HTTP
listener. The artifact documents the existing Region routes as well as the
Place routes; it is not served by `/swagger/json`. CI checks the contract,
checks that public Swagger excludes internal routes, validates representative
API responses against the generated schemas, and publishes a short-lived
`internal-regions-openapi` workflow artifact. Artifact access follows the
repository's GitHub Actions permissions.

Update the controller/DTO annotations and contract tests when changing these
routes; do not hand-edit a generated specification. The generated API version
header is optional and defaults to `1`.

## Region ids

The same ids are what public `GET /search` takes as `region` and `GET
/regions/:id` returns outlines for — see [area-search.md](area-search.md).

`state:MO` (postal code), `county:29095` (5-digit FIPS), `place:5363000`
(7-digit Census place GEOID), `zip:64130`. The `:id` route validates the form
exactly (`^(state:[A-Z]{2}|county:\d{5}|place:\d{7}|zip:\d{5})$`): a malformed id is 400, a
well-formed id with no Region is 404. The colon may be sent raw or as `%3A`.

## Typeahead

- **Digits (1 to 5).** `q` is a ZIP prefix: `prefix` on the `zip` keyword,
  ZIPs only, ordered by ZIP ascending. There is no score, so `states` has no
  effect. If `types` is given without `zip`, the answer is empty and ES is
  not called. County FIPS codes are not searched.
- **Anything else** searches `name` (`search_as_you_type`) with a
  `bool_prefix` `multi_match` over `name`, `name._2gram` and `name._3gram`,
  `operator: and`: every word must match, the last may be a prefix. Ordered by
  score, then `id` ascending.
- **Boosts.** Each boost adds a fixed amount through `constant_score`. A
  boosted `term` would instead scale with how rare the term is: a boost of 3
  on `type: state` scored about 20.

  | Boost             | Adds                     | When                                                                                                                                                                                          |
  | ----------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Exact state       | 100                      | The whole text is a state's postal code or name ("MO", "missouri", "new york").                                                                                                               |
  | State name prefix | 10                       | At least 3 characters, and a state's full name starts with the text ("kan" → Kansas; "miss" → Mississippi, Missouri; "new" → the four New states). The exact state is not counted again here. |
  | Type order        | state 3, county 2, ZIP 0 | Always, on the text branch, so state > county > ZIP when name scores are close. "jackson mo" puts Jackson County, MO (7.5 + 2) above the ZIP for Jackson, MO (8.5 + 0).                       |
  | `states`          | 4                        | The Region is in one of the listed states. Enough for an in-state ZIP (0 + 4) to beat an out-of-state county (+2) on an equal name match.                                                     |

  The two state boosts are alternatives to the name match: a state can match
  on them alone. That is how "DC" finds District of Columbia although its
  name holds no "dc" word. Text of 1 or 2 characters gets only the exact-code
  rule, so "ok" lifts Oklahoma and nothing else.

- **`states` is a bias, not a filter.** Other states still appear. It lets a
  tenant's own area rank first among similar matches.
- **`types`** (`state`, `county`, `zip`) filters. `types` and `states` take a
  comma list or repeated params.
- **No geometry.** Typeahead asks ES for `id`, `type`, `name`, `state` only.

## Known limitations

- **"Saint" does not match "St."** Names are stored as "St. Louis County,
  MO", and the index has no synonym for it. "st louis" finds it, "saint
  louis" finds nothing. Not planned for v1.
- **No Places in typeahead.** The existing search remains limited to states,
  counties and ZIPs even when the catalog contains Places.

## Lookup

`GET /internal/regions/:id` returns the GeoJSON `geometry` (Polygon or
MultiPolygon, tens of KB for a county) and, for counties, the simplemaps
`attribution` the UI must show. `fips` and `zip` appear only on the Region type
they belong to.

Search filtering against a Region (ISS-1873) does not fetch this geometry:
it uses `geo_shape` `indexed_shape` against index `regions`, id = the Region
id (documents are stored with `_id` equal to `id`). See
[geography-filter.md](geography-filter.md#geography-and-virtual-clauses).

## Place Regions

These endpoints read published `type: place` documents from the same global
`regions` alias. They do not filter by tenant or indicate tenant coverage.
Dagster publishes state partitions on demand; unmatched and unpublished Places
are not listed. Slug lookup matches the current canonical slug exactly and
returns 404 if it is not published.

The list is sorted by slug then Region ID. Pass its `next_cursor` to the next
request with the same `state` filter; null means the last page. State is an
uppercase two-letter postal code. Pagination is not a snapshot: a catalog
publication between requests can alter later pages. List responses omit geometry.

The detail returns centroid as `{lat, lng}`, geometry as GeoJSON Polygon or
MultiPolygon, and `bbox` as `[minLng, minLat, maxLng, maxLat]`, calculated from
all geometry coordinates. `fips` is the seven-digit Census GEOID as a string.
Place IDs are not accepted by the existing Region-by-ID or Geography filters.

For a locally configured API and Elasticsearch alias containing published Places:

```sh
curl -H "x-internal-api-key: $INTERNAL_API_KEY" \
  'http://localhost:8080/internal/regions/places?state=WA&limit=2'
curl -H "x-internal-api-key: $INTERNAL_API_KEY" \
  'http://localhost:8080/internal/regions/places/spokane-wa'
```

Configure the API's `ELASTIC_NODE`, `ELASTIC_API_KEY` and `INTERNAL_API_KEY`
for the local environment. The API also needs its normal startup dependencies.

## Errors

ES timeout is 503; any other ES failure is 502.
