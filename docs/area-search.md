# Area search on `GET /search`

Searching by an **area** (state, county, city, ZIP) instead of a point and a
radius, over plain GET. The product-level design and tickets live in Norse:
`docs/area-search.md` and `docs/area-search-tickets.md`. This page is the API
side.

## Three ways to say where

Precedence `region` > `coords` > `location`; at most one decides the search.

| Param                                       | Search                                                                                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `region=county:53077[,…]` (1–20 Region ids) | area: see "What matches"; `distance` ignored; `coords`, if sent, is only the origin for `sort=distance` and hybrid proximity                  |
| `coords` (+ `distance`, `geo_type`)         | point: unchanged                                                                                                                              |
| `location=Yakima` (+ `state=WA`)            | free text: geocoded (Mapbox), then the first hit's `region_id` is searched like `region=`, or its point (`coords` + the request's `distance`) |

- `location` is ignored when `region` or `coords` is present: Norse has always
  sent its display label as `location` next to `coords`.
- `state` keeps only geocoder hits whose `state_code` matches; no hit is a
  400 `Could not resolve location "…" in XX`. An ambiguous name otherwise
  takes Mapbox's best match.
- `resolved_location: { input?, regions: [{ id, type, name }], coords? }` is
  added to the response when `region` or `location` decided the search.

Code: `SearchLocationService` (`src/search/internal/location/`) settles the
query before `SearchService` runs, so classic, hybrid and printable
directories all get the same behaviour.

## What matches a Region

`SearchUtilsService.buildRegionFilter`: per Region, a `bool.should` of

- `service_area` `geo_shape` intersects `indexed_shape(regions, id, geometry)`
- `location.point` `geo_shape` intersects `indexed_shape(regions, id, geometry)`

ES reads each shape by id from the `regions` index; nothing large is sent and
the request stays a cacheable GET. Unknown ids are a 400 from one `mget`
(`RegionService.getSummaries`).

The Region ids join the search fingerprint only when present, so every
search without them keeps its shard preference and cache keys.

## Geocoder hit → Region

`RegionService.regionOf(hit)`:

| Mapbox `place_type` | Region type                                           |
| ------------------- | ----------------------------------------------------- |
| `region`            | `state` (only with a US state code, not a metro area) |
| `district`          | `county`                                              |
| `place`             | `place`                                               |
| `postcode`          | `zip`                                                 |
| anything else       | none: the hit stays a point                           |

One `geo_shape` point query on `regions` returns every Region containing the
hit's `center`; the wanted type wins, else the next larger (zip → place →
county → state), so an unseeded city searches its county. A point on a
shared border resolves by id order.

`GET /geocoding/forward` runs it for every Mapbox hit on a cache miss and
caches `region_id` (null for points) and `state_code` with the hit, under
`geocode:forward:v2:`. After a Region reseed that adds a type (cities), bump
that key to apply it at once; otherwise entries pick it up as they expire
(7 days).

## `GET /regions/:id`

Public, tenant header required. Returns `RegionDetailDto`
(`id, type, name, state, centroid?, fips?, zip?, geometry, attribution?`) —
what Norse draws as the searched area. The internal
`/internal/regions/:id` is unchanged.

## Printable directories

`defaultQueryConfig.regionId`: a query source with no `region` and no
`coords` of its own gets `region`; `radius` is then not applied.

## `POST /search` (deprecated)

Answers with `Deprecation: true`, is `deprecated` in OpenAPI, and logs
`Deprecated POST /search called: tenant=… geo_type=…`. Removed once the logs
show no callers (see Norse `docs/area-search-tickets.md`).
