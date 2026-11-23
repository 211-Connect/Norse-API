import { SearchRequest } from '@elastic/elasticsearch/lib/api/types';
import { REGIONS_INDEX } from './region.constants';
import { StateRegionType } from './dto/state-regions.dto';

/** More than any state has: Texas has 254 counties and under 2,000 places. */
export const STATE_REGIONS_MAX = 5000;

export interface StateRegionSource {
  id: string;
  type: StateRegionType;
  name: string;
  state: string;
  slug?: string;
  place_type?: string;
}

/** Every county and/or place of one state, without geometry. */
export function stateRegionsRequest(
  state: string,
  types: readonly StateRegionType[],
): SearchRequest {
  return {
    index: REGIONS_INDEX,
    size: STATE_REGIONS_MAX,
    track_total_hits: false,
    _source: ['id', 'type', 'name', 'state', 'slug', 'place_type'],
    query: {
      bool: {
        filter: [{ terms: { type: [...types] } }, { term: { state } }],
      },
    },
    sort: [{ id: 'asc' }],
  };
}

/**
 * The places of a state whose centroid (a `geo_point`) lies within one
 * county's stored boundary. A place's county is the one containing its
 * centroid, so a place spanning two counties still has exactly one.
 */
export function placesInCountyRequest(
  state: string,
  countyId: string,
): SearchRequest {
  return {
    index: REGIONS_INDEX,
    size: STATE_REGIONS_MAX,
    track_total_hits: false,
    _source: ['id'],
    query: {
      bool: {
        filter: [
          { term: { type: 'place' } },
          { term: { state } },
          {
            geo_shape: {
              centroid: {
                indexed_shape: {
                  index: REGIONS_INDEX,
                  id: countyId,
                  path: 'geometry',
                },
                relation: 'within',
              },
            },
          },
        ],
      },
    },
  };
}
