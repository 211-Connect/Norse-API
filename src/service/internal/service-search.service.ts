import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { errors } from '@elastic/elasticsearch';
import {
  AggregationsCompositeAggregate,
  AggregationsCompositeAggregateKey,
  SearchRequest,
} from '@elastic/elasticsearch/lib/api/types';
import { buildAirsTreeFromPathCounts, normalizeAirsCode } from './airs';
import {
  SERVICES_SEARCH_DEFAULT_LIMIT,
  ServiceListItemDto,
  ServicesFacetsRequestDto,
  ServicesFacetsResponseDto,
  ServicesScopeFilterDto,
  ServicesSearchRequestDto,
  ServicesSearchResponseDto,
} from './dto';
import { REGIONS_INDEX } from '../../region/internal/region.query';
import {
  SERVICE_LIST_SOURCE_FIELDS,
  SERVICES_INDEX,
  buildServiceFilter,
  serviceListSort,
  sortModeFor,
  textClause,
} from './service-search.query';
import {
  CursorQuery,
  decodeCursor,
  encodeCursor,
  shardPreference,
} from './service-search.cursor';

/** Buckets per composite page; facets page until exhausted, never truncate. */
export const FACET_PAGE_SIZE = 1000;

const FACET_FIELDS = {
  contributors: 'resourceWriterId',
  statuses: 'status',
  taxonomyPath: 'taxonomyPath',
  taxonomyCodes: 'taxonomyCodes',
} as const;
type FacetName = keyof typeof FACET_FIELDS;

interface ServiceSource {
  serviceId?: string;
  tenant_id?: string;
  resourceWriterId?: string;
  isCanonicalPublication?: boolean;
  status?: string;
  taxonomyPath?: string[];
  taxonomyCodes?: string[];
  locationTypes?: string[];
  name?: string;
  alternateName?: string;
  description?: string;
  organizationName?: string;
  city?: string;
  assuredDate?: string;
}

@Injectable()
export class ServiceSearchService {
  private readonly logger = new Logger(ServiceSearchService.name);

  constructor(private readonly elasticsearch: ElasticsearchService) {}

  async search(
    request: ServicesSearchRequestDto,
  ): Promise<ServicesSearchResponseDto> {
    const limit = request.limit ?? SERVICES_SEARCH_DEFAULT_LIMIT;
    const cursorQuery: CursorQuery = {
      resourceWriterIds: request.resourceWriterIds,
      taxonomyCodes: request.filter?.taxonomyCodes,
      statuses: request.filter?.statuses,
      ...scopeFilterInput(request.filter),
      text: request.text,
    };
    const mode = sortModeFor(request.text);
    const searchAfter =
      request.cursor === undefined
        ? undefined
        : decodeCursor(request.cursor, mode, cursorQuery);

    const scope = buildServiceFilter(cursorQuery);
    if (scope === null) return { items: [], total: 0, limit, nextCursor: null };
    await this.assertRegionsExist(cursorQuery.regionIds);

    const body: SearchRequest = {
      index: SERVICES_INDEX,
      preference: shardPreference(cursorQuery),
      // One extra hit says whether a next page exists, so the last page
      // returns a null cursor instead of one that leads to an empty page.
      size: limit + 1,
      // Without this ES stops counting at 10,000 and the total would lie.
      track_total_hits: true,
      _source: SERVICE_LIST_SOURCE_FIELDS,
      query: { bool: { ...scope, must: textClause(request.text) } },
      sort: serviceListSort(mode),
      ...(searchAfter ? { search_after: searchAfter } : {}),
    };

    const result = await this.call('search', () =>
      this.elasticsearch.search<ServiceSource>(body),
    );
    const total =
      typeof result.hits.total === 'number'
        ? result.hits.total
        : (result.hits.total?.value ?? 0);
    const page = result.hits.hits.slice(0, limit);
    const last = page[page.length - 1];

    return {
      items: page.map((hit) => toListItem(hit._id, hit._source)),
      total,
      limit,
      nextCursor:
        result.hits.hits.length > limit && last?.sort
          ? encodeCursor(mode, cursorQuery, last.sort)
          : null,
    };
  }

  async facets(
    request: ServicesFacetsRequestDto,
  ): Promise<ServicesFacetsResponseDto> {
    const input = {
      resourceWriterIds: request.resourceWriterIds,
      ...scopeFilterInput(request.filter),
    };
    const scope = buildServiceFilter(input);
    if (scope === null) return { contributors: [], statuses: [], taxonomy: [] };
    await this.assertRegionsExist(input.regionIds);

    const buckets = await this.collectFacetBuckets(
      { bool: scope },
      shardPreference(input),
    );

    // Normalized as the path is: codes are stored as written ("BD-1800."), the
    // path as its canonical key, so comparing raw would mark a directly coded
    // term as synthesized.
    const coded = new Set(
      buckets.taxonomyCodes.map((b) => normalizeAirsCode(b.key)),
    );

    return {
      contributors: buckets.contributors
        .map((b) => ({ resourceWriterId: b.key, recordCount: b.count }))
        .sort((a, b) => a.resourceWriterId.localeCompare(b.resourceWriterId)),
      // A blank status is an option no `$in` can usefully match.
      statuses: buckets.statuses
        .filter((b) => b.key !== '')
        .map((b) => ({ value: b.key, recordCount: b.count }))
        .sort((a, b) => a.value.localeCompare(b.value)),
      taxonomy: buildAirsTreeFromPathCounts(
        buckets.taxonomyPath.map((b) => ({
          code: b.key,
          recordCount: b.count,
        })),
        coded,
      ).map((n) => ({ ...n, name: n.code })),
    };
  }

  /**
   * Every bucket of each facet, paged with composite aggregations. A `terms`
   * aggregation with a fixed size would silently drop the tail of a large
   * taxonomy, which reads as "no records under this code".
   */
  private async collectFacetBuckets(
    query: SearchRequest['query'],
    preference: string,
  ): Promise<Record<FacetName, { key: string; count: number }[]>> {
    const out: Record<FacetName, { key: string; count: number }[]> = {
      contributors: [],
      statuses: [],
      taxonomyPath: [],
      taxonomyCodes: [],
    };
    let pending = new Map<FacetName, AggregationsCompositeAggregateKey | null>(
      (Object.keys(FACET_FIELDS) as FacetName[]).map((name) => [name, null]),
    );

    while (pending.size > 0) {
      const aggs = Object.fromEntries(
        [...pending].map(([name, after]) => [
          name,
          {
            composite: {
              size: FACET_PAGE_SIZE,
              sources: [{ key: { terms: { field: FACET_FIELDS[name] } } }],
              ...(after ? { after } : {}),
            },
          },
        ]),
      );
      const result = await this.call('facets', () =>
        this.elasticsearch.search({
          index: SERVICES_INDEX,
          preference,
          size: 0,
          track_total_hits: false,
          query,
          aggs,
        }),
      );

      const next = new Map<FacetName, AggregationsCompositeAggregateKey>();
      for (const name of pending.keys()) {
        const agg = result.aggregations?.[name] as
          AggregationsCompositeAggregate | undefined;
        const page = agg?.buckets ?? [];
        const bucketList = Array.isArray(page) ? page : Object.values(page);
        for (const bucket of bucketList) {
          out[name].push({
            key: String(bucket.key.key),
            count: bucket.doc_count,
          });
        }
        if (bucketList.length === FACET_PAGE_SIZE && agg?.after_key) {
          next.set(name, agg.after_key);
        }
      }
      pending = next;
    }
    return out;
  }

  /**
   * ES answers `indexed_shape` with a missing id as a 400, which would surface
   * as a 502. One `mget` first turns it into a 400 naming every unknown id.
   */
  private async assertRegionsExist(
    regionIds: readonly string[] | undefined,
  ): Promise<void> {
    if (!regionIds || regionIds.length === 0) return;
    const result = await this.call('region check', () =>
      this.elasticsearch.mget({
        index: REGIONS_INDEX,
        ids: [...regionIds],
        _source: false,
      }),
    );
    const found = new Set(
      result.docs.filter((d) => 'found' in d && d.found).map((d) => d._id),
    );
    const unknown = regionIds.filter((id) => !found.has(id));
    if (unknown.length > 0) throw unknownRegions(unknown);
  }

  /** Downstream failures: a timeout is 503, anything else 502. */
  private async call<T>(what: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // A Region deleted between the check and the search.
      const missingShape = missingShapeId(error);
      if (missingShape !== null) throw unknownRegions([missingShape]);
      if (error instanceof errors.TimeoutError) {
        this.logger.error(`Services ${what} timed out`);
        throw new ServiceUnavailableException(`Services ${what} timed out`);
      }
      this.logger.error(`Services ${what} failed: ${error?.message}`);
      throw new BadGatewayException(`Services ${what} failed`);
    }
  }
}

function scopeFilterInput(filter: ServicesScopeFilterDto | undefined) {
  const regionIds = filter?.geography?.regionIds;
  return {
    regionIds: regionIds ? [...new Set(regionIds)] : undefined,
    virtual: filter?.virtual,
  };
}

function unknownRegions(ids: readonly string[]) {
  return new BadRequestException(`Unknown Region id(s): ${ids.join(', ')}`);
}

const MISSING_SHAPE = /Shape with ID \[([^\]]+)\][^"]*not found/;

/** The id from ES's 400 for an `indexed_shape` it cannot find, else null. */
function missingShapeId(error: unknown): string | null {
  if (!(error instanceof errors.ResponseError) || error.statusCode !== 400) {
    return null;
  }
  const match = MISSING_SHAPE.exec(JSON.stringify(error.meta?.body ?? ''));
  return match ? match[1] : null;
}

function toListItem(
  id: string | undefined,
  source: ServiceSource | undefined,
): ServiceListItemDto {
  const s = source ?? {};
  return {
    id: id ?? '',
    serviceId: s.serviceId ?? '',
    tenantId: s.tenant_id ?? '',
    resourceWriterId: s.resourceWriterId ?? '',
    isCanonicalPublication: s.isCanonicalPublication !== false,
    status: s.status ?? null,
    taxonomyPath: s.taxonomyPath ?? [],
    taxonomyCodes: s.taxonomyCodes ?? [],
    locationTypes: s.locationTypes ?? [],
    name: s.name ?? null,
    alternateName: s.alternateName ?? null,
    description: s.description ?? null,
    organizationName: s.organizationName ?? null,
    city: s.city ?? null,
    assuredDate: s.assuredDate ?? null,
  };
}
