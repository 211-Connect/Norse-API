import { SearchRequest } from '@elastic/elasticsearch/lib/api/types';
import { RegionType } from './dto';

/**
 * The alias Dagster loads (PR #602). ISS-1873 filters search against a Region
 * with `indexed_shape` on this same alias.
 */
export const REGIONS_INDEX = 'regions';

export const REGION_SUMMARY_FIELDS = ['id', 'type', 'name', 'state'];
export const REGION_DETAIL_FIELDS = [
  ...REGION_SUMMARY_FIELDS,
  'fips',
  'zip',
  'geometry',
  'attribution',
];

/** Lifts the named state far above any name match score. */
export const EXACT_STATE_BOOST = 100;
/** Enough to reorder ties and near-ties, not to bury a clearly better match. */
export const NEAR_STATE_BOOST = 2;

const ZIP_PREFIX = /^\d{1,5}$/;

const STATE_NAMES: Record<string, string> = {
  AK: 'Alaska',
  AL: 'Alabama',
  AR: 'Arkansas',
  AZ: 'Arizona',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DC: 'District of Columbia',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  IA: 'Iowa',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  MA: 'Massachusetts',
  MD: 'Maryland',
  ME: 'Maine',
  MI: 'Michigan',
  MN: 'Minnesota',
  MO: 'Missouri',
  MS: 'Mississippi',
  MT: 'Montana',
  NC: 'North Carolina',
  ND: 'North Dakota',
  NE: 'Nebraska',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NV: 'Nevada',
  NY: 'New York',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VA: 'Virginia',
  VT: 'Vermont',
  WA: 'Washington',
  WI: 'Wisconsin',
  WV: 'West Virginia',
  WY: 'Wyoming',
};

const normalize = (text: string) =>
  text.trim().toLowerCase().replace(/\s+/g, ' ');

const STATE_BY_TEXT = new Map<string, string>(
  Object.entries(STATE_NAMES).flatMap(([code, name]) => [
    [code.toLowerCase(), code],
    [normalize(name), code],
  ]),
);

/** The state code when the whole text is a state's code or name. */
export function exactStateCode(text: string): string | undefined {
  return STATE_BY_TEXT.get(normalize(text));
}

export function isZipPrefix(text: string): boolean {
  return ZIP_PREFIX.test(text);
}

export interface RegionSearchInput {
  q: string;
  types?: RegionType[];
  states?: string[];
  limit: number;
}

/**
 * The ES request for a typeahead, or null when the request cannot match
 * anything (digits with a type filter that excludes ZIPs).
 */
export function buildRegionSearch(
  input: RegionSearchInput,
): SearchRequest | null {
  const q = input.q.trim();
  const base = {
    index: REGIONS_INDEX,
    size: input.limit,
    track_total_hits: false,
    _source: REGION_SUMMARY_FIELDS,
  };

  if (isZipPrefix(q)) {
    if (input.types && !input.types.includes('zip')) return null;
    return {
      ...base,
      query: {
        bool: {
          filter: [{ term: { type: 'zip' } }, { prefix: { zip: q } }],
        },
      },
      sort: [{ zip: { order: 'asc' } }],
    };
  }

  const nameMatch = {
    multi_match: {
      query: q,
      type: 'bool_prefix' as const,
      fields: ['name', 'name._2gram', 'name._3gram'],
      operator: 'and' as const,
    },
  };
  const state = exactStateCode(q);
  const must = state
    ? {
        bool: {
          should: [
            nameMatch,
            {
              term: {
                id: { value: `state:${state}`, boost: EXACT_STATE_BOOST },
              },
            },
          ],
          minimum_should_match: 1,
        },
      }
    : nameMatch;

  return {
    ...base,
    query: {
      bool: {
        must: [must],
        filter: input.types ? [{ terms: { type: input.types } }] : [],
        should: input.states?.length
          ? [{ terms: { state: input.states, boost: NEAR_STATE_BOOST } }]
          : [],
      },
    },
    sort: [{ _score: { order: 'desc' } }, { id: { order: 'asc' } }],
  };
}

export function buildRegionGet(id: string): SearchRequest {
  return {
    index: REGIONS_INDEX,
    size: 1,
    track_total_hits: false,
    _source: REGION_DETAIL_FIELDS,
    query: { term: { id } },
  };
}
