# Internal Region typeahead and lookup

ServiceNet's Geography filter turns typed text into a Region and a Region into
its boundary through two internal routes over the Elasticsearch **alias
`regions`** (currently `regions_v1`). Dagster loads the index once from the
Region seed (Dagster PR #602, INTEG-023). See architecture-docs ADR 0024 (ArchitectureDocs PR #31) and
INTEG-024.

| Route | Query | Returns |
| --- | --- | --- |
| `GET /internal/regions` | `q` (required), `types`, `states`, `limit` (default 10, max 25) | `{ items: [{ id, type, name, state }] }` |
| `GET /internal/regions/:id` | — | `{ id, type, name, state, fips?, zip?, geometry, attribution? }` |

Send `x-api-version: 1`, as for every versioned route. No `x-tenant-id`:
Regions are not tenant data.

## Status

- **Unpublished.** `@ApiExcludeController()` keeps both routes out of
  `/swagger/json`, so the Norse SDK never sees them.
  `region.controller.spec.ts` checks the generated document.
- **Unauthenticated.** Auth is ISS-1876. ISS-1887 blocks `/internal/*` at the
  gateway, and these routes must not deploy before it lands.

## Region ids

`state:MO` (postal code), `county:29095` (5-digit FIPS), `zip:64130`. The
`:id` route validates the form exactly
(`^(state:[A-Z]{2}|county:\d{5}|zip:\d{5})$`): a malformed id is 400, a
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

  | Boost | Adds | When |
  | --- | --- | --- |
  | Exact state | 100 | The whole text is a state's postal code or name ("MO", "missouri", "new york"). |
  | State name prefix | 10 | At least 3 characters, and a state's full name starts with the text ("kan" → Kansas; "miss" → Mississippi, Missouri; "new" → the four New states). The exact state is not counted again here. |
  | Type order | state 3, county 2, ZIP 0 | Always, on the text branch, so state > county > ZIP when name scores are close. "jackson mo" puts Jackson County, MO (7.5 + 2) above the ZIP for Jackson, MO (8.5 + 0). |
  | `states` | 4 | The Region is in one of the listed states. Enough for an in-state ZIP (0 + 4) to beat an out-of-state county (+2) on an equal name match. |

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
- **No city Regions** (ADR 0024). "kansas city" returns the ZIPs whose name
  carries the city.

## Lookup

`GET /internal/regions/:id` returns the GeoJSON `geometry` (Polygon or
MultiPolygon, tens of KB for a county) and, for counties, the simplemaps
`attribution` the UI must show. `fips` and `zip` appear only on the Region type
they belong to.

Search filtering against a Region (ISS-1873) should not fetch this geometry:
use `geo_shape` `indexed_shape` against index `regions`, id = the Region id
(documents are stored with `_id` equal to `id`).

## Errors

ES timeout is 503; any other ES failure is 502.
