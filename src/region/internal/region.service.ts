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
import { buildRegionGet, buildRegionSearch } from './region.query';
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
