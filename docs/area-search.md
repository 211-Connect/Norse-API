# Area search

How `GET /search` searches an area (a state, county, city or ZIP) instead of a
point, and how a geocoder hit becomes that area. Point searches (`coords` +
`distance`) are unchanged and described in [location-search.md](location-search.md).

The code: `SearchUtilsService.buildRegionFilter`
(`src/search/search-utils.service.ts`), `SearchService.withArea`
(`src/search/search.service.ts`), `RegionService.regionOf` / `getSummaries`
(`src/region/internal/region.service.ts`) and the constants in
`src/search/internal/area/area-match.ts`.

## Request

| Param        | Meaning                                                                                                                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `region`     | One or more Region ids, comma list, up to 20: `state:WA`, `county:53033` (5-digit FIPS), `place:5363000` (7-digit Census place GEOID), `zip:98101`. A resource matching **any** of them is returned. Unknown ids are a 400. |
| `area_match` | `located`, `located_or_serving` or `serving` — see [Modes](#modes). Absent: the tenant default, else `located_or_serving`.                                                                                                  |
| `unlocated`  | Which resources with neither a location nor a service area are also returned: `none`, `virtual` (only virtual services) or `all`. Absent: the tenant default, else `virtual`.                                               |

With `region` set, `distance` and `geo_type` are ignored: an area is searched
as its shape, never as a radius. `coords`, if also sent, only sets the origin
for `sort=distance` (and hybrid's distance score); Norse sends the Region's
centroid.

Every search path uses the same filter: keyword, taxonomy, more-like-this,
hybrid, `GET /search/pins` and printable directories. `SearchService.withArea`
settles the area once per request (it checks the ids exist and fills the
defaults), then both builders pass it to `buildFilters`.

The Region shapes live in the global `regions` index (Dagster loads it, see
[internal-regions.md](internal-regions.md)). The filter names a shape by id
with `indexed_shape`, so no geometry travels in the request and `GET /search`
stays CDN-cacheable.

## Modes

A resource has up to two geographic fields: a **location** (`location.point`,
where it is) and a **service area** (`service_area`, where it serves). In the
diagrams the dashed outline is the searched Region, a dot is a resource's
location and a shaded shape is its service area. Green resources match.

| Mode                           | Resource **with** a location                               | Resource **without** a location, with a service area |
| ------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------- |
| `located`                      | location inside the Region                                 | never                                                |
| `located_or_serving` (default) | location inside the Region                                 | service area overlaps the Region                     |
| `serving`                      | location inside the Region **or** service area overlaps it | service area overlaps the Region                     |

`unlocated` adds, in every mode, resources with **neither** field. They cannot
be placed anywhere, so they match every area search or none:

| `unlocated`         | Resources with neither a location nor a service area              |
| ------------------- | ----------------------------------------------------------------- |
| `none`              | left out                                                          |
| `virtual` (default) | only virtual services (`location.physical_address.type: virtual`) |
| `all`               | all of them, including physical services missing their address    |

A virtual service with no service area usually serves everyone, so `virtual`
lists it; a physical one with neither field is missing data, not a claim to
serve the area.

### `located` — physically in the area

<svg viewBox="0 0 520 200" width="520" height="200" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif" font-size="12">
  <rect x="140" y="30" width="240" height="140" rx="10" fill="none" stroke="#555" stroke-width="2" stroke-dasharray="6 4"/>
  <text x="150" y="48" fill="#555">Region (e.g. King County)</text>
  <circle cx="220" cy="110" r="7" fill="#2e7d32"/>
  <text x="232" y="114" fill="#2e7d32">A: office inside ✓</text>
  <circle cx="440" cy="110" r="7" fill="#c62828"/>
  <rect x="340" y="70" width="160" height="90" rx="8" fill="#c62828" fill-opacity="0.12" stroke="#c62828"/>
  <text x="400" y="185" fill="#c62828">B: office outside, serves the Region ✗</text>
  <rect x="20" y="60" width="150" height="80" rx="8" fill="#c62828" fill-opacity="0.12" stroke="#c62828" stroke-dasharray="2 3"/>
  <text x="26" y="155" fill="#c62828">C: no office, serves it ✗</text>
</svg>

Only A. Use it for a brochure of places a person can walk into.

### `located_or_serving` — in the area, plus virtual services for it (default)

<svg viewBox="0 0 520 200" width="520" height="200" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif" font-size="12">
  <rect x="140" y="30" width="240" height="140" rx="10" fill="none" stroke="#555" stroke-width="2" stroke-dasharray="6 4"/>
  <text x="150" y="48" fill="#555">Region</text>
  <circle cx="220" cy="110" r="7" fill="#2e7d32"/>
  <text x="232" y="114" fill="#2e7d32">A: office inside ✓</text>
  <circle cx="440" cy="110" r="7" fill="#c62828"/>
  <rect x="340" y="70" width="160" height="90" rx="8" fill="#c62828" fill-opacity="0.12" stroke="#c62828"/>
  <text x="400" y="185" fill="#c62828">B: office outside ✗</text>
  <rect x="20" y="60" width="150" height="80" rx="8" fill="#2e7d32" fill-opacity="0.15" stroke="#2e7d32" stroke-dasharray="2 3"/>
  <text x="26" y="155" fill="#2e7d32">C: no office, serves it ✓</text>
</svg>

A and C. A resource with an office is judged only by where the office is, so
B (an office in the next county that also serves this one) is left out. A
resource with no office (a hotline, a PO box) is judged by its service area.

### `serving` — anyone who serves the area

<svg viewBox="0 0 520 200" width="520" height="200" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif" font-size="12">
  <rect x="140" y="30" width="240" height="140" rx="10" fill="none" stroke="#555" stroke-width="2" stroke-dasharray="6 4"/>
  <text x="150" y="48" fill="#555">Region</text>
  <circle cx="220" cy="110" r="7" fill="#2e7d32"/>
  <text x="232" y="114" fill="#2e7d32">A: office inside ✓</text>
  <circle cx="440" cy="110" r="7" fill="#2e7d32"/>
  <rect x="340" y="70" width="160" height="90" rx="8" fill="#2e7d32" fill-opacity="0.15" stroke="#2e7d32"/>
  <text x="400" y="185" fill="#2e7d32">B: office outside, serves it ✓</text>
  <rect x="20" y="60" width="150" height="80" rx="8" fill="#2e7d32" fill-opacity="0.15" stroke="#2e7d32" stroke-dasharray="2 3"/>
  <text x="26" y="155" fill="#2e7d32">C: no office, serves it ✓</text>
</svg>

A, B and C. B's statewide-style service area overlaps the Region, so it is in
even though its office is not. Expect many more results than the other modes
for small Regions: a county search includes every service whose area reaches
over the county line.

"Overlaps" is Elasticsearch `intersects`: sharing any part of the Region, not
covering all of it. "Inside" is the same relation on a point, so a location
on the Region's border counts as inside.

## Tenant defaults

`area_match` and `unlocated` default per tenant from the CMS search
settings (Payload, search tab), which Payload writes to Redis DB 2 under
`search_config:<tenantId>` as `area_match` and `unlocated_in_area_search`
(`SearchConfigCache`). A caller's params always win. An unset or invalid
tenant value falls back to `located_or_serving` / `virtual`. A cache written
before `unlocated_in_area_search` existed holds the boolean
`include_unlocated_in_area_search` instead: `true` reads as `all`. Norse
sends both params explicitly; the
defaults matter for other callers (Keeper, agents) so they get the tenant's
behavior. `/v2/search` ignores the tenant `unlocated_in_area_search` default and uses `virtual` unless the caller sends `unlocated` (Lucas 2026-11-18).

A printable directory can override the mode with
`defaultQueryConfig.areaMatch` (null: tenant default), applied with its
`defaultQueryConfig.regionId` — see below.

## Response

An area search adds `resolved_location`:

```json
{
  "resolved_location": {
    "regions": [
      {
        "id": "county:53033",
        "type": "county",
        "name": "King County, WA",
        "state": "WA",
        "centroid": { "lat": 47.49, "lng": -121.83 }
      }
    ],
    "area_match": "located_or_serving",
    "unlocated": "virtual"
  }
}
```

It is absent for `coords` searches and searches with no location. The
outline is not in the search response (2–40 KB per Region, and it would repeat
on every page and on `/search/pins`): fetch it once from
`GET /regions/:id` (`x-tenant-id` required, like every public route), which
returns `{ id, type, name, state, centroid, geometry, fips?, zip?, attribution? }`.
Compute the bounding box from `geometry` to fit the map.

## Geocoder hit → Region

`GET /geocoding/forward` (Mapbox) adds to each hit its own `name`, its
`state_code` and `region_id`, the Region it is an area of. A client that
lets a person pick a place sends `region=<region_id>` when it is set, and
`coords` (with a radius) when it is null.

| Mapbox `place_type`                                                     | Region        | How                                                                                                                                                                          |
| ----------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `region` (a US state)                                                   | `state:XX`    | by the state code                                                                                                                                                            |
| `postcode`                                                              | `zip:NNNNN`   | by the ZIP itself                                                                                                                                                            |
| `district`                                                              | `county:FIPS` | the county in the same state whose shape contains the hit's point                                                                                                            |
| `place`                                                                 | `place:GEOID` | the place in the same state whose shape contains the hit's point **and** whose name (or Census alias, e.g. `Aberdeen city`) equals the hit's name, ignoring case and accents |
| anything else (`address`, `poi`, `neighborhood`, `locality`, `country`) | none          | a point                                                                                                                                                                      |

`region_id` is null — so the client falls back to `coords` + radius, today's
behavior — when:

- the place has no Region yet: only Washington places are seeded today,
  other states' cities follow when their places are loaded;
- the ZIP has no Region: PO-box-only ZIPs (e.g. `21021`) are not in the
  Census ZCTA shapes;
- the name does not match: Mapbox's name differs from the Census name (a
  translated name in a non-English locale, an unincorporated community whose
  point lies inside a differently named CDP).

A hit never widens to a larger Region: a city without a place Region does not
become its county. The lookup runs once per geocoder cache miss and is cached
with the hit (`geocode:forward:v2:…`, 7 days). A failed lookup leaves the
hit a point rather than failing the geocode. OpenCage hits get no
`region_id`.

## Printable directories

`defaultQueryConfig.regionId` scopes a directory to a Region. Query sources
with no location of their own (`region` or `coords`) then search that Region
with `defaultQueryConfig.areaMatch` (if set), and `defaultQueryConfig.radius`
is not applied; `defaultQueryConfig.coords` stays as the distance-sort
origin. Directories without `regionId` behave as before.

## POST /search

Deprecated. It existed only to carry a GeoJSON `geometry` body for
`geo_type=boundary`, which `region` replaces. It answers with a
`Deprecation: true` header and logs `Deprecated POST /search called
(tenant=…, geo_type=…)` on every call. Once that log stays empty for a few
weeks, the endpoint and `SearchResourcesBodyDto` are removed.
