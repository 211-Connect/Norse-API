import {
  BadGatewayException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { errors } from '@elastic/elasticsearch';
import {
  REGION_SEARCH_DEFAULT_LIMIT,
  RegionDetailDto,
  RegionSearchQueryDto,
  RegionSearchResponseDto,
  RegionSummaryDto,
  RegionType,
} from './dto';
import { buildRegionGet, buildRegionSearch } from './region.query';

interface RegionSource {
  id?: string;
  type?: RegionType;
  name?: string;
  state?: string;
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

  /** Downstream failures: a timeout is 503, anything else 502. */
  private async call<T>(what: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof errors.TimeoutError) {
        this.logger.error(`Region ${what} timed out`);
        throw new ServiceUnavailableException(`Region ${what} timed out`);
      }
      this.logger.error(`Region ${what} failed: ${error?.message}`);
      throw new BadGatewayException(`Region ${what} failed`);
    }
  }
}

function toSummary(source: RegionSource): RegionSummaryDto {
  return {
    id: source.id ?? '',
    type: source.type as RegionType,
    name: source.name ?? '',
    state: source.state ?? '',
  };
}
