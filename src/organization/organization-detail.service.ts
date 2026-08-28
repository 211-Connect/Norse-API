import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { Organization } from 'src/common/schemas/organization.schema';
import { Redirect } from 'src/common/schemas/redirect.schema';
import { OrganizationDetail } from './types/organization-response.types';
import { filterTranslationsByLocale } from './organization-detail.transform';

type LookupPath = 'primary' | 'fallback' | 'fallback_no_tenant';

type AggregatedOrganization = Organization & { _id: string };

@Injectable()
export class OrganizationDetailService {
  private readonly logger = new Logger(OrganizationDetailService.name);

  constructor(
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
    @InjectModel(Redirect.name)
    private readonly redirectModel: Model<Redirect>,
  ) {}

  async findById(
    id: string,
    options: { headers: HeadersDto },
  ): Promise<OrganizationDetail> {
    const tenantId = options.headers['x-tenant-id'];
    const locale = options.headers['accept-language'];
    const organization = await this.findOrganizationWithFallback(id, tenantId);
    return this.transformOrganization(organization, locale);
  }

  // Mirrors ResourceService: organizationId -> mongo _id (legacy links) ->
  // cross-tenant organizationId (shared orgs), then redirect, then 404.
  private async findOrganizationWithFallback(
    urlId: string,
    tenantId: string,
  ): Promise<AggregatedOrganization> {
    let results = await this.aggregateOrganizations({
      tenant_id: tenantId,
      organizationId: urlId,
    });
    let lookupPath: LookupPath = 'primary';

    if (!results[0]) {
      results = await this.aggregateOrganizations({
        tenant_id: tenantId,
        _id: urlId,
      });
      lookupPath = 'fallback';
    }

    if (!results[0]) {
      results = await this.aggregateOrganizations({ organizationId: urlId });
      lookupPath = 'fallback_no_tenant';
    }

    const organization = results[0];

    if (organization) {
      if (lookupPath !== 'primary') {
        this.logger.warn(
          `Organization lookup used ${lookupPath} path: ${JSON.stringify({
            lookupPath,
            tenantId,
            organizationId: urlId,
            mongoId: organization._id,
          })}`,
        );
      }
      return organization;
    }

    const redirect = await this.redirectModel.findById(urlId).exec();
    if (redirect) {
      throw new NotFoundException({ redirect: `/search/${redirect.newId}` });
    }

    throw new NotFoundException();
  }

  // Locale scoping is post-fetch (filterTranslationsByLocale) to reach nested
  // TRANSLATIONS arrays, so the aggregation only resolves the document.
  private async aggregateOrganizations(
    matchQuery: FilterQuery<Organization>,
  ): Promise<AggregatedOrganization[]> {
    return this.organizationModel.aggregate([{ $match: matchQuery }]).exec();
  }

  // Drop internal `_id`/`logo`, then locale-filter translations. Denylist, not
  // allow-list: every other stored field is kept so a consumed-but-unenumerated
  // field is never silently dropped.
  private transformOrganization(
    organization: AggregatedOrganization,
    locale: string,
  ): OrganizationDetail {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _id, logo, ...rest } = organization;

    return filterTranslationsByLocale(rest as OrganizationDetail, locale);
  }
}
