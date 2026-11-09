import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { callElasticsearch } from 'src/common/elasticsearch/es-call';
import {
  REGION_SEARCH_DEFAULT_LIMIT,
  RegionDetailDto,
  RegionSearchQueryDto,
  RegionSearchResponseDto,
  RegionSummaryDto,
  RegionType,
} from './dto';
import { REGIONS_INDEX, unknownRegionsError } from './region.constants';
import {
  REGION_SUMMARY_FIELDS,
  buildRegionGet,
  buildRegionSearch,
  buildRegionsContaining,
} from './region.query';

/** A geocoder hit, as `GeocodeResponseDto` carries it. */
export interface GeocodeHit {
  /** `[lng, lat]`. */
  coordinates: [number, number];
  place_type?: string[];
  /** US state code; the Mapbox mapper sets it. */
  state_code?: string;
}

/**
 * Mapbox `place_type` → the Region type the hit is an area of. Anything else
 * (address, POI, neighborhood, locality, country) stays a point.
 */
const REGION_TYPE_BY_PLACE_TYPE: Record<string, RegionType> = {
  region: 'state',
  district: 'county',
  place: 'place',
  postcode: 'zip',
};

/** Smallest first: a type with no Region at the point falls back to the next. */
const BY_SIZE: RegionType[] = ['zip', 'place', 'county', 'state'];

interface RegionSource {
  id?: string;
  type?: RegionType;
  name?: string;
  state?: string;
  /** GeoJSON position, [lng, lat], as the Dagster loader writes it. */
  centroid?: [number, number] | null;
  fips?: string | null;
  zip?: string | null;
  geometry?: Record<string, unknown>;
  attribution?: { text: string; url?: string } | null;
}

@Injectable()
export class RegionService {
  private readonly logger = new Logger(RegionService.name);

  constructor(private readonly elasticsearch: ElasticsearchService) {}

  async search(query: RegionSearchQueryDto): Promise<RegionSearchResponseDto> {
    const request = buildRegionSearch({
      q: query.q,
      types: query.types,
      states: query.states,
      limit: query.limit ?? REGION_SEARCH_DEFAULT_LIMIT,
    });
    if (request === null) return { items: [] };

    const result = await this.call('search', () =>
      this.elasticsearch.search<RegionSource>(request),
    );
    return {
      items: result.hits.hits.map((hit) => toSummary(hit._source ?? {})),
    };
  }

  async get(id: string): Promise<RegionDetailDto> {
    const result = await this.call('lookup', () =>
      this.elasticsearch.search<RegionSource>(buildRegionGet(id)),
    );
    const source = result.hits.hits[0]?._source;
    if (!source) throw new NotFoundException(`Region ${id} not found`);

    const detail: RegionDetailDto = {
      ...toSummary(source),
      geometry: source.geometry ?? {},
    };
    if (source.fips) detail.fips = source.fips;
    if (source.zip) detail.zip = source.zip;
    if (source.attribution) detail.attribution = source.attribution;
    return detail;
  }

  /**
   * A 400 naming every id with no Region. ES answers an `indexed_shape` on a
   * missing id with its own 400, which would otherwise surface as a 502.
   */
  async assertExist(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const result = await this.call('check', () =>
      this.elasticsearch.mget({
        index: REGIONS_INDEX,
        ids: [...ids],
        _source: false,
      }),
    );
    const found = new Set(
      result.docs.filter((d) => 'found' in d && d.found).map((d) => d._id),
    );
    const unknown = ids.filter((id) => !found.has(id));
    if (unknown.length > 0) throw unknownRegionsError(unknown);
  }

  /**
   * The Regions in the order asked, or a 400 naming every id with no Region
   * (the same answer `assertExist` gives).
   */
  async getSummaries(ids: readonly string[]): Promise<RegionSummaryDto[]> {
    if (ids.length === 0) return [];
    const result = await this.call('check', () =>
      this.elasticsearch.mget<RegionSource>({
        index: REGIONS_INDEX,
        ids: [...ids],
        _source: REGION_SUMMARY_FIELDS,
      }),
    );
    const byId = new Map<string, RegionSource>();
    for (const doc of result.docs) {
      if ('found' in doc && doc.found && doc._source) {
        byId.set(doc._id, doc._source);
      }
    }
    const unknown = ids.filter((id) => !byId.has(id));
    if (unknown.length > 0) throw unknownRegionsError(unknown);
    return ids.map((id) => toSummary(byId.get(id)));
  }

  /**
   * The Region a geocoder hit is an area of, or null for a point — see
   * docs/area-search.md. A place with no Region of its own (e.g. a city not
   * seeded yet) falls back to the next larger Region, its county.
   */
  async regionOf(hit: GeocodeHit): Promise<RegionSummaryDto | null> {
    const type = REGION_TYPE_BY_PLACE_TYPE[hit.place_type?.[0] ?? ''];
    // Mapbox also calls metro areas a region; only a US state has a code.
    if (!type || (type === 'state' && !hit.state_code)) return null;

    const result = await this.call('containing', () =>
      this.elasticsearch.search<RegionSource>(
        buildRegionsContaining(hit.coordinates),
      ),
    );
    const containing = result.hits.hits.map((h) => toSummary(h._source ?? {}));
    for (const candidate of BY_SIZE.slice(BY_SIZE.indexOf(type))) {
      const region = containing.find((r) => r.type === candidate);
      if (region) return region;
    }
    return null;
  }

  private call<T>(what: string, run: () => Promise<T>): Promise<T> {
    return callElasticsearch(
      { label: `Region ${what}`, logger: this.logger },
      run,
    );
  }
}

function toSummary(source: RegionSource): RegionSummaryDto {
  const [lng, lat] = source.centroid ?? [];
  return {
    id: source.id ?? '',
    type: source.type as RegionType,
    name: source.name ?? '',
    state: source.state ?? '',
    ...(typeof lat === 'number' && typeof lng === 'number'
      ? { centroid: { lat, lng } }
      : {}),
  };
}
