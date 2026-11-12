# Location in resource search

How the public resource search (`GET` / `POST /search`, keyword and hybrid)
uses a caller's location: which results it filters out, how it ranks the rest,
and how it sorts. ServiceNet's internal services search has its own rules, in
[geography-filter.md](geography-filter.md).

The code is `SearchUtilsService.buildFilters` and `buildSortClause`
(`src/search/search-utils.service.ts`), shared by keyword and hybrid search, and
`HybridSearchService`'s scoring functions (`src/search/hybrid-search.service.ts`).

## Inputs

| Param | Meaning |
| --- | --- |
| `coords` | `lon,lat` of the searcher. Without it, nothing below applies: no geo filter, no distance ranking, and `sort=distance` falls back to relevance. |
| `distance` | Radius in whole miles. **`0`, the default, means no radius filter.** Norse sends `0` when the user picks "Any" in the distance dropdown, and when no distance is set. |
| `geo_type` | Omitted (default), `proximity`, or `boundary`. |
| `geometry` | GeoJSON shape in the `POST` body, for `boundary` only. |
| `sort` | `relevance` (default), `distance`, `name`, `organization`. |

## What a result carries

Each result has at most one of each:

- `location.point` (`geo_point`), its map point. It is missing when the
  location has no coordinates. **A location typed `virtual` never has one**:
  the Dagster connectors drop it, even when the source sends coordinates.
- `service_area` (`geo_shape`), the area the service says it serves.

A result without a point can only be placed by its service area. The data
rules that keep that true are in dagster-data-orchestration
`docs/search-readiness-mapping-rules.md`.

## Filters

With `coords`, a result must pass these. "Point" means `location.point`.

| `geo_type` | `distance` | Result **with** a point | Result **without** a point |
| --- | --- | --- | --- |
| omitted | > 0 | service area contains `coords` **and** point within `distance` | service area contains `coords` |
| omitted | 0 | service area contains `coords` | service area contains `coords` |
| `proximity` | > 0 | point within `distance` (service area ignored) | service area contains `coords` |
| `proximity` | 0 | **no geo filter** | **no geo filter** |
| `boundary` | ignored | service area intersects `geometry` | service area intersects `geometry` |

Consequences:

- **A result with neither a point nor a service area** is never returned by a
  coordinate search, except `proximity` with `distance` 0, which returns
  everything.
- **Default mode drops results whose service area doesn't cover the searcher,
  even when they are next door.** In the ISS-2755 repro, Massena Wellness
  Center (0.4 mi from the search point) is missing from default-mode results
  for "counseling" near Massena, NY. Use `proximity` for "near me" searches.
- `boundary` needs a `POST` body. `GET` returns `400`.

Before ISS-2755, the `proximity` row admitted a result without a point
unconditionally, so it matched every proximity search in the tenant.

## Ranking (hybrid search only)

Keyword search has no distance score. Hybrid search adds a distance score to
the text and semantic scores (`boost_mode: sum`):

- `25 × gauss(location.point)`, with origin `coords`, offset 0 and decay 0.5
  at the scale. Scale is `distance` miles, or 5 miles when `distance` is 0. A
  result at the search point gets +25; one at the scale distance gets +12.5.
- **The distance score applies only to results that have a point.** An
  Elasticsearch decay function scores a document that lacks the field as 1,
  the same as one at the origin, so before ISS-2755 a result without a point
  got the full +25.
- A result without a point gets nothing from distance when the query has text,
  so the semantic function scores every document. In a **browse search** (no
  query text, with `coords`), distance is the only function. A document that
  matches no function scores 1, so a result without a point gets +1 there.
  Measured on the CNY211 index on 2026-11-12: 1 with the filter, 25 without.
- The weight (25) and default scale (5 mi) are constants, `GEO_GAUSS_WEIGHT`
  and `GEO_DEFAULT_SCALE_MI`. Payload's hybrid-search config shows geo-boost
  weight and scale fields, but Norse-API doesn't read them: `SearchConfigCache`
  has no geo fields.

## Sorting

- `sort=distance` with `coords`: nearest first (`_geo_distance` on
  `location.point`). **Results without a point sort last**: their sort value
  is `Infinity` (checked against the live index on 2026-11-12). Without
  `coords`: by relevance.
- `sort=relevance` means score. The exception is keyword search with
  `query_type=taxonomy` and `coords`, where it means distance (taxonomy
  matching is binary, so score carries no signal). Hybrid search has no such
  exception.
- Pinned/priority tiers come **before** distance:
  - Keyword search: `priority` first, unless the tenant's pinned mode is
    `ignore`.
  - Hybrid search: `pinned` then `priority`, only in `top` mode.
- A final tiebreak on id keeps paging stable.

## Who sends what

- **Norse UI:** `coords` and `distance` (`0` for "Any"), no `geo_type`, so
  default mode.
- **API consumers** such as Keeper: often `geo_type=proximity` with a
  `distance`.

Changing any row of the filter table changes results for one of them. It is a
behaviour change on a public contract, so update the `geo_type` description
in `search.controller.ts` and `dto/search-query.dto.ts` with it, and give
consumers notice (ISS-2485).
