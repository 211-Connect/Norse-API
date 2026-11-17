/**
 * How an area search (`region` on GET /search) decides that a resource is in
 * the area — see docs/area-search.md for the diagrams.
 *
 * - `located`: the resource's location (`location.point`) is inside the area.
 *   Resources without a location are left out.
 * - `located_or_serving` (default): a resource with a location must be inside
 *   the area; a resource without one (virtual, PO box) matches when its
 *   `service_area` overlaps the area.
 * - `serving`: the location is inside the area OR the `service_area` overlaps
 *   it, so a statewide hotline with an office elsewhere still matches.
 */
export const AREA_MATCH_VALUES = [
  'located',
  'located_or_serving',
  'serving',
] as const;
export type AreaMatch = (typeof AREA_MATCH_VALUES)[number];

export const DEFAULT_AREA_MATCH: AreaMatch = 'located_or_serving';

/** The tenant's CMS default, or `located_or_serving` when unset or invalid. */
export function tenantAreaMatch(config: { area_match?: unknown }): AreaMatch {
  return (AREA_MATCH_VALUES as readonly unknown[]).includes(config.area_match)
    ? (config.area_match as AreaMatch)
    : DEFAULT_AREA_MATCH;
}

/** At most this many Region ids in one `region` param. */
export const MAX_REGION_IDS = 20;

/** What a search filters by when it is scoped to Regions. */
export interface AreaFilter {
  regionIds: string[];
  match: AreaMatch;
  /** Also match resources with neither a location nor a service_area. */
  includeUnlocated: boolean;
}

export const REGION_PARAM_DESCRIPTION =
  'Search an area instead of a point: one or more Region ids (comma list, up ' +
  'to 20), e.g. `county:53077` or `county:53077,county:53033` — `state:XX`, ' +
  '`county:<5-digit FIPS>`, `place:<7-digit Census GEOID>` or `zip:<5 ' +
  'digits>`. A resource matching any of them is returned; `area_match` says ' +
  'what matching means. Takes precedence over `coords`: `distance` and ' +
  '`geo_type` are ignored, and `coords`, if sent, only sets the origin for ' +
  '`sort=distance`. Unknown ids are a 400. Ids come from `GET ' +
  '/geocoding/forward` (`region_id`). See docs/area-search.md.';

export const AREA_MATCH_PARAM_DESCRIPTION =
  'Only with `region`. `located`: the resource is located inside the area; ' +
  'resources without a location are left out. `located_or_serving`: a ' +
  'resource with a location must be inside the area, one without a location ' +
  'matches when its service_area overlaps the area. `serving`: located inside ' +
  'the area OR its service_area overlaps it. Absent: the tenant default from ' +
  'the CMS, else `located_or_serving`.';

export const INCLUDE_UNLOCATED_PARAM_DESCRIPTION =
  'Only with `region`. `true` also returns resources with neither a location ' +
  'nor a service_area, which cannot be placed in any area. Absent: the tenant ' +
  'default from the CMS, else `false`.';
