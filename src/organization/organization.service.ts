import { Injectable, Logger } from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { SearchRequest } from '@elastic/elasticsearch/lib/api/types';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { SearchOrganizationQueryDto } from './dto/search-organization-query.dto';
import { OrganizationSearchResponseDto } from './dto/search-organization-response.dto';

export const ORGANIZATIONS_INDEX = 'organizations';

@Injectable()
export class OrganizationService {
  private readonly logger = new Logger(OrganizationService.name);

  constructor(private readonly elasticsearchService: ElasticsearchService) {}

  /**
   * @param options.onlyWithResources Exclude organizations Dagster counted at 0
   *   service-at-locations in the tenant's directory. Internal only, not on the
   *   DTO: `/suggestion` sets it so the search bar never offers an organization
   *   whose selection finds nothing, while `GET /organization` (ServiceNet
   *   provider-feedback, INTEG-011) keeps returning every organization.
   */
  async search(options: {
    headers: HeadersDto;
    query: SearchOrganizationQueryDto;
    onlyWithResources?: boolean;
  }): Promise<OrganizationSearchResponseDto> {
    const text = options.query.query?.trim() ?? '';
    const { page, limit } = options.query;
    const tenantFilter = {
      term: { tenant_id: options.headers['x-tenant-id'] },
    };
    // `must_not term 0`, not `range gt 0`: fails open, so a document indexed
    // before Dagster wrote the count (or while the field is still unmapped)
    // stays suggestible instead of vanishing until its tenant republishes.
    const resourceFilter = options.onlyWithResources
      ? { must_not: [{ term: { service_at_location_count: 0 } }] }
      : {};
    const textQuery = text
      ? {
          bool: {
            filter: [tenantFilter],
            ...resourceFilter,
            should: [
              { match_phrase: { name: { query: text, boost: 12 } } },
              { match_phrase: { alternate_name: { query: text, boost: 8 } } },
              {
                multi_match: {
                  query: text,
                  type: 'bool_prefix' as const,
                  fields: [
                    'name',
                    'name._2gram',
                    'name._3gram',
                    'alternate_name',
                    'alternate_name._2gram',
                    'alternate_name._3gram',
                  ],
                  boost: 4,
                },
              },
            ],
            minimum_should_match: 1,
          },
        }
      : { bool: { filter: [tenantFilter], ...resourceFilter } };
    const request: SearchRequest = {
      index: ORGANIZATIONS_INDEX,
      from: (page - 1) * limit,
      size: limit,
      _source: [
        'organization_id',
        'tenant_id',
        'resource_writer_id',
        'name',
        'alternate_name',
        'email',
        'website',
        'phone',
        'location',
      ],
      query: textQuery,
      // organization_id last in both branches: without a unique final key,
      // score ties are ordered by Lucene doc order, which is not stable
      // between identical requests.
      sort: text
        ? [{ _score: { order: 'desc' } }, { organization_id: { order: 'asc' } }]
        : [
            { 'name.raw': { order: 'asc' } },
            { organization_id: { order: 'asc' } },
          ],
    };

    try {
      const result = await this.elasticsearchService.search(request);
      const total =
        typeof result.hits.total === 'number'
          ? result.hits.total
          : (result.hits.total?.value ?? 0);
      return {
        took: result.took ?? 0,
        timed_out: result.timed_out ?? false,
        total,
        page,
        limit,
        hits: result.hits.hits as OrganizationSearchResponseDto['hits'],
      };
    } catch (error) {
      this.logger.error('Organization search failed', error);
      throw error;
    }
  }
}
