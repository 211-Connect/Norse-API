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
import {
  PlaceDetailDto,
  PlaceListDto,
  PlaceListQueryDto,
} from './dto/place.dto';
import {
  encodePlaceCursor,
  placeDetail,
  placeListRequest,
  placeLookupRequest,
  placeSummary,
  PlaceSource,
} from './place.query';

interface RegionSource {
  id?: string;
  type?: RegionType;
  name?: string;
  state?: string;
  /** GeoJSON position, [lng, lat], as the Dagster loader writes it. */
  centroid?: [number, number] | null;
  fips?: string | null;
  zip?: string | null;
  aliases?: string[];
  geometry?: Record<string, unknown>;
  /** `{ text, url }` on states, counties and ZIPs; seed provenance on places. */
  attribution?: Record<string, unknown> | null;
}

/** A forward-geocoding hit, as `GeocodeResponseDto` carries it. */
export interface GeocodeHit {
  /** `[lng, lat]`. */
  coordinates: [number, number];
  place_type?: string[];
  /** The hit's own name: `Seattle`, `King County`, `98101`. */
  name?: string;
  /** US state code; the Mapbox mapper sets it. */
  state_code?: string;
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

  async listPlaces(query: PlaceListQueryDto): Promise<PlaceListDto> {
    const limit = query.limit ?? 25;
    const result = await this.call('place list', () =>
      this.elasticsearch.search<PlaceSource>(placeListRequest(query)),
    );
    const hits = result.hits.hits.slice(0, limit);
    const last = hits[hits.length - 1]?._source;
    return {
      items: hits.map((hit) => placeSummary(hit._source!)),
      next_cursor:
        result.hits.hits.length > limit && last
          ? encodePlaceCursor(query.state, last.slug, last.id)
          : null,
    };
  }

  async getPlace(slug: string): Promise<PlaceDetailDto> {
    const result = await this.call('place lookup', () =>
      this.elasticsearch.search<PlaceSource>(placeLookupRequest(slug)),
    );
    const source = result.hits.hits[0]?._source;
    if (!source) throw new NotFoundException(`Place ${slug} not found`);
    return placeDetail(source);
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
    // Places keep their seed provenance (a second copy of the boundary) here.
    const { text, url } = source.attribution ?? {};
    if (typeof text === 'string') {
      detail.attribution = { text, ...(typeof url === 'string' && { url }) };
    }
    return detail;
  }

  /**
   * The Regions in the order asked, or a 400 naming every id with no Region
   * (the same answer `assertExist` gives).
   */
  async getSummaries(ids: readonly string[]): Promise<RegionSummaryDto[]> {
    if (ids.length === 0) return [];
    const byId = await this.mget(ids);
    const unknown = ids.filter((id) => !byId.has(id));
    if (unknown.length > 0) throw unknownRegionsError(unknown);
    return ids.map((id) => toSummary(byId.get(id)!));
  }

  /**
   * The Region a geocoder hit is an area of, or null when the hit is a point
   * or has no Region of its own — the caller then searches it with `coords`
   * and a radius. Never widens to a larger Region. See docs/area-search.md.
   */
  async regionOf(hit: GeocodeHit): Promise<RegionSummaryDto | null> {
    const placeType = hit.place_type?.[0];
    const name = hit.name?.trim();

    // A state and a ZIP name their Region outright.
    if (placeType === 'region') {
      return hit.state_code ? this.find(`state:${hit.state_code}`) : null;
    }
    if (placeType === 'postcode') {
      return name && /^\d{5}$/.test(name) ? this.find(`zip:${name}`) : null;
    }

    const type =
      placeType === 'district'
        ? 'county'
        : placeType === 'place'
          ? 'place'
          : undefined;
    if (!type || !hit.state_code || !Array.isArray(hit.coordinates)) {
      return null;
    }

    const result = await this.call('containing', () =>
      this.elasticsearch.search<RegionSource>(
        buildRegionsContaining(hit.coordinates, type),
      ),
    );
    const candidates = result.hits.hits
      .map((h) => h._source ?? {})
      .filter((source) => source.state === hit.state_code);
    // A city's point can sit inside a neighbouring place or CDP, so a place
    // must also carry the hit's name. A county is whichever contains it.
    const match =
      type === 'place'
        ? candidates.find((source) => sameName(source, name))
        : candidates[0];
    return match ? toSummary(match) : null;
  }

  private async find(id: string): Promise<RegionSummaryDto | null> {
    const source = (await this.mget([id])).get(id);
    return source ? toSummary(source) : null;
  }

  private async mget(
    ids: readonly string[],
  ): Promise<Map<string, RegionSource>> {
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
    return byId;
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

  private call<T>(what: string, run: () => Promise<T>): Promise<T> {
    return callElasticsearch(
      { label: `Region ${what}`, logger: this.logger },
      run,
    );
  }
}

/** Lower case, no accents, single spaces: `Coeur d'Alene` = `coeur d'alene`. */
function normalizeName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** The place's name or Census alias (`Aberdeen city`) is the hit's name. */
function sameName(source: RegionSource, name: string | undefined): boolean {
  if (!name) return false;
  const wanted = normalizeName(name);
  return [source.name, ...(source.aliases ?? [])].some(
    (candidate) =>
      typeof candidate === 'string' && normalizeName(candidate) === wanted,
  );
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
