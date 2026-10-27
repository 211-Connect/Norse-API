import { BadRequestException, Injectable } from '@nestjs/common';
import { GeocodingService } from 'src/geocoding/geocoding.service';
import {
  ForwardGeocodeQueryDto,
  GeocodingProvider,
} from 'src/geocoding/dto/geocoding.dto';
import { RegionService } from 'src/region/internal';
import { SearchResourcesQueryDto } from '../../dto/search-query.dto';
import { ResolvedLocationDto } from '../../dto/search-response.dto';

export interface LocationResolution {
  /** The query to search with: `region`, `coords` and `distance` settled. */
  query: SearchResourcesQueryDto;
  /** Set when `region` or `location` decided where the search is scoped. */
  resolved?: ResolvedLocationDto;
}

/**
 * Settles where a search is scoped, by precedence `region` > `coords` >
 * `location` — see docs/area-search.md.
 */
@Injectable()
export class SearchLocationService {
  constructor(
    private readonly regionService: RegionService,
    private readonly geocodingService: GeocodingService,
  ) {}

  async resolve(q: SearchResourcesQueryDto): Promise<LocationResolution> {
    if (q.region?.length) return this.inRegions(q, q.region);

    const text = q.location?.trim();
    if (q.coords || !text) return { query: q };

    const hits = await this.geocodingService.forwardGeocode({
      address: text,
      provider: GeocodingProvider.MAPBOX,
      locale: 'en',
      // More candidates when some will be filtered out by state.
      limit: q.state ? 10 : 5,
    } as ForwardGeocodeQueryDto);
    const hit = hits.find((h) => !q.state || h.state_code === q.state);
    if (!hit) {
      throw new BadRequestException(
        `Could not resolve location "${text}"${q.state ? ` in ${q.state}` : ''}`,
      );
    }

    const coords = hit.coordinates;
    if (hit.region_id) {
      const area = await this.inRegions({ ...q, coords }, [hit.region_id]);
      return { ...area, resolved: { input: text, ...area.resolved } };
    }
    return {
      query: { ...q, coords },
      resolved: { input: text, regions: [], coords },
    };
  }

  /** A Region is searched as its shape: no radius; `coords` is only the origin. */
  private async inRegions(
    q: SearchResourcesQueryDto,
    ids: string[],
  ): Promise<LocationResolution> {
    const regions = await this.regionService.getSummaries(ids);
    return {
      query: { ...q, region: ids, distance: 0 },
      resolved: {
        regions: regions.map(({ id, type, name }) => ({ id, type, name })),
        ...(q.coords ? { coords: q.coords } : {}),
      },
    };
  }
}
