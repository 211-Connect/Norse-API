import {
  SearchRequest,
  SearchResponse as EsSearchResponse,
} from '@elastic/elasticsearch/lib/api/types';
import {
  SearchPinDto,
  SearchPinsResponseDto,
} from '../dto/search-pins-response.dto';
import { SearchSource } from '../dto/search-response.dto';
import { SearchUtilsService } from '../search-utils.service';

export const SEARCH_PINS_LIMIT = 10_000;

/**
 * Narrows a list request to what a pin needs: no facets, no full documents, and
 * only located resources, which would otherwise use up the limit without a pin.
 */
export const toPinsRequest = (request: SearchRequest): SearchRequest => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { aggs, _source_excludes, ...rest } = request;

  return {
    ...rest,
    query: {
      bool: {
        must: request.query ? [request.query] : [],
        filter: [{ exists: { field: 'location.point' } }],
      },
    },
    _source: [
      'service_at_location_id',
      'name',
      'location.point',
      'location.physical_address.address_1',
      'location.physical_address.address_2',
      'location.physical_address.city',
      'location.physical_address.state',
      'location.physical_address.postal_code',
    ],
  };
};

export const toPinsResponse = (
  data: EsSearchResponse<SearchSource>,
): SearchPinsResponseDto => {
  const { total: hitsTotal } = data.hits;
  const total =
    typeof hitsTotal === 'number' ? hitsTotal : (hitsTotal?.value ?? 0);
  // Classic search stops counting at the limit, so its total can't exceed it.
  const isCountCut =
    typeof hitsTotal === 'object' && hitsTotal.relation === 'gte';

  const pins = data.hits.hits.flatMap((hit): SearchPinDto[] => {
    const point = SearchUtilsService.parseLocationPoint(
      hit._source?.location?.point,
    );
    // `exists` passes values that don't parse, such as a malformed legacy point.
    if (!point) return [];

    return [
      {
        id: hit._id as string,
        service_at_location_id: hit._source?.service_at_location_id ?? null,
        name: hit._source?.name ?? null,
        physical_address: hit._source?.location?.physical_address ?? null,
        coordinates: [point.lon, point.lat],
      },
    ];
  });

  return { total, truncated: total > SEARCH_PINS_LIMIT || isCountCut, pins };
};
