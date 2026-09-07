import { Injectable } from '@nestjs/common';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { SuggestionSearchQueryDto } from './dto/search-query.dto';
import { TaxonomyTermsQueryDto } from './dto/taxonomy-terms-query.dto';
import { OrganizationService } from 'src/organization/organization.service';
import { TaxonomyService } from 'src/taxonomy/taxonomy.service';
import { TenantConfigService } from 'src/cms-config/tenant-config.service';
import {
  OrganizationSuggestionItemDto,
  SuggestionCombinedResponseDto,
} from './dto/suggestion-response.dto';

const ORGANIZATION_SUGGESTION_LIMIT = 8;

/**
 * Combined typeahead for the Norse frontend's search bar. Always returns
 * both taxonomy and organization matches in one round trip — this is what
 * distinguishes `/suggestion` from `/taxonomy` (which owns taxonomy search
 * on its own). Taxonomy lookups are delegated to `TaxonomyService` rather
 * than reimplemented here, to avoid maintaining two copies of the same
 * Elasticsearch query.
 */
@Injectable()
export class SuggestionService {
  constructor(
    private readonly taxonomyService: TaxonomyService,
    private readonly organizationService: OrganizationService,
    private readonly tenantConfigService: TenantConfigService,
  ) {}

  async getSuggestions(options: {
    headers: HeadersDto;
    query: SuggestionSearchQueryDto;
  }): Promise<SuggestionCombinedResponseDto> {
    const { headers, query } = options;

    const searchConfig = await this.tenantConfigService.getSearchConfig(
      headers['x-tenant-id'],
    );
    const organizationSearchEnabled =
      searchConfig.organization_search_enabled ?? false;

    const [taxonomyResult, organizations] = await Promise.all([
      this.taxonomyService.searchTaxonomiesV2({
        headers,
        query: {
          query: query.query,
          page: query.page,
        },
      }),
      organizationSearchEnabled
        ? this.searchOrganizations({ headers, query })
        : [],
    ]);

    return { taxonomies: taxonomyResult.items, organizations };
  }

  private async searchOrganizations(options: {
    headers: HeadersDto;
    query: SuggestionSearchQueryDto;
  }): Promise<OrganizationSuggestionItemDto[]> {
    const orgResults = await this.organizationService.search({
      headers: options.headers,
      query: {
        query: options.query.query,
        page: 1,
        limit: ORGANIZATION_SUGGESTION_LIMIT,
      },
    });

    return orgResults.hits.map((hit) => ({
      organization_id: hit._source.organization_id,
      name: hit._source.name,
      city: hit._source.location?.city ?? null,
      state: hit._source.location?.state ?? null,
    }));
  }

  async getTaxonomyTermsForCodes(options: {
    headers: HeadersDto;
    query: TaxonomyTermsQueryDto;
  }) {
    return this.taxonomyService.getTaxonomyTermsForCodes(options);
  }
}
