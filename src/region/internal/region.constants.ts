import { BadRequestException } from '@nestjs/common';
import { ValidationArguments } from 'class-validator';

/**
 * The alias Dagster loads (PR #602). Services search reads Region shapes from
 * it with `indexed_shape`, so both modules must name the same alias.
 */
export const REGIONS_INDEX = 'regions';

/**
 * `state:MO`, `county:29095` (5-digit FIPS), `place:5363000` (7-digit Census
 * place GEOID) or `zip:64130`.
 */
export const REGION_ID_PATTERN =
  /^(state:[A-Z]{2}|county:\d{5}|place:\d{7}|zip:\d{5})$/;

/** Where a Region document keeps its boundary. */
export const REGION_GEOMETRY_PATH = 'geometry';

/**
 * The boundary a resource's `service_area` is matched against in an area
 * search. Switch to `geometry_interior` (the shape shrunk by ~1 km, so a
 * service area that only touches the border does not match) once Dagster
 * loads it — see docs/area-search.md.
 */
export const REGION_SERVICE_AREA_PATH = REGION_GEOMETRY_PATH;

/** The validation message for a Region id, alone or as each item of a list. */
export function regionIdMessage({ property, value }: ValidationArguments) {
  const subject = Array.isArray(value) ? `each value in ${property}` : property;
  return `${subject} must be state:XX, county:<5-digit FIPS>, place:<7-digit GEOID> or zip:<5 digits>`;
}

export function unknownRegionsError(ids: readonly string[]) {
  return new BadRequestException(`Unknown Region id(s): ${ids.join(', ')}`);
}
