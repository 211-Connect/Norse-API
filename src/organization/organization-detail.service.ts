import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { HeadersDto } from 'src/common/dto/headers.dto';
import {
  Organization,
  OrganizationServiceEntry,
} from 'src/common/schemas/organization.schema';
import { Redirect } from 'src/common/schemas/redirect.schema';
import { ResourceService } from 'src/resource/resource.service';
import { OrganizationInclude } from './dto/organization-detail-query.dto';
import {
  OrganizationDetail,
  OrganizationDetailResponse,
  OrganizationTranslation,
} from './types/organization-response.types';

type LookupPath = 'primary' | 'fallback' | 'fallback_no_tenant';

/**
 * An organization document after the aggregation has filtered its top-level
 * `translations` array down to the requested locale (+ English).
 */
type AggregatedOrganization = Omit<Organization, 'translations'> & {
  _id: string;
  organizationId?: string;
  services?: OrganizationServiceEntry[];
  translations: OrganizationTranslation[];
};

@Injectable()
export class OrganizationDetailService {
  private readonly logger = new Logger(OrganizationDetailService.name);

  constructor(
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
    @InjectModel(Redirect.name)
    private readonly redirectModel: Model<Redirect>,
    private readonly resourceService: ResourceService,
  ) {}

  /**
   * Fetch a single organization's full detail, optionally sideloading its
   * service-at-location resources.
   */
  async findById(
    id: string,
    options: { headers: HeadersDto; include?: OrganizationInclude[] },
  ): Promise<OrganizationDetailResponse> {
    const tenantId = options.headers['x-tenant-id'];
    const locale = options.headers['accept-language'];

    const organization = await this.findOrganizationWithFallback(
      id,
      tenantId,
      locale,
    );

    const response: OrganizationDetailResponse = {
      data: this.transformOrganization(organization, locale),
    };

    if (options.include?.includes(OrganizationInclude.RESOURCES)) {
      await this.attachResources(organization, options.headers, response);
    }

    return response;
  }

  /**
   * Looks up an organization by its public organizationId using the same
   * 3-tier fallback chain the resource endpoint uses:
   *   1. primary: tenant-scoped lookup by organizationId.
   *   2. fallback: tenant-scoped lookup by mongo _id (legacy links).
   *   3. fallback_no_tenant: cross-tenant lookup by organizationId, for orgs
   *      that are intentionally shared/global across tenants.
   */
  private async findOrganizationWithFallback(
    urlId: string,
    tenantId: string,
    locale: string,
  ): Promise<AggregatedOrganization> {
    let results = await this.aggregateOrganizations(
      { tenant_id: tenantId, organizationId: urlId },
      locale,
    );
    let lookupPath: LookupPath = 'primary';

    if (!results[0]) {
      results = await this.aggregateOrganizations(
        { tenant_id: tenantId, _id: urlId },
        locale,
      );
      lookupPath = 'fallback';
    }

    if (!results[0]) {
      results = await this.aggregateOrganizations(
        { organizationId: urlId },
        locale,
      );
      lookupPath = 'fallback_no_tenant';
    }

    const organization = results[0];

    if (organization) {
      if (lookupPath === 'primary') {
        this.logger.debug(
          `Organization lookup path=primary tenantId=${tenantId} organizationId=${urlId}`,
        );
      } else {
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

  private async aggregateOrganizations(
    matchQuery: FilterQuery<Organization>,
    locale: string,
  ): Promise<AggregatedOrganization[]> {
    return this.organizationModel
      .aggregate([
        { $match: matchQuery },
        this.buildTranslationFilterStage(locale),
      ])
      .exec();
  }

  /**
   * Filters the org-level `translations` array to the requested locale (+ the
   * English canonical), mirroring the resource endpoint's locale scoping. Note
   * the org uses an upper-cased `LOCALE` key.
   */
  private buildTranslationFilterStage(locale: string) {
    return {
      $addFields: {
        translations: {
          $filter: {
            input: '$translations',
            as: 't',
            cond: {
              $or: [
                { $eq: ['$$t.LOCALE', locale] },
                { $eq: ['$$t.LOCALE', 'en'] },
              ],
            },
          },
        },
      },
    };
  }

  /**
   * Collapses the filtered translations to a single locale-resolved entry.
   * Unlike the resource endpoint this is lenient: a missing translation yields
   * `null` rather than a 400, since org-level descriptions are optional and
   * should not fail the whole detail response.
   */
  private transformOrganization(
    organization: AggregatedOrganization,
    locale: string,
  ): OrganizationDetail {
    const translations = organization.translations ?? [];
    const translation: OrganizationTranslation | null =
      translations.find((t) => t?.LOCALE === locale) ??
      translations.find((t) => t?.LOCALE === 'en') ??
      null;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { translations: _dropped, ...rest } = organization;

    return { ...rest, translation };
  }

  /**
   * Hydrates every service-at-location ID on the org into a full resource via
   * the existing /resource/batch service, and attaches the result as an
   * `included.resources` map plus an `include` meta summary.
   */
  private async attachResources(
    organization: AggregatedOrganization,
    headers: HeadersDto,
    response: OrganizationDetailResponse,
  ): Promise<void> {
    const salIds = this.collectServiceAtLocationIds(organization);

    if (salIds.length === 0) {
      response.included = { resources: {} };
      response.meta = {
        resources: { requested: 0, successful: 0, failed: 0, errors: [] },
      };
      return;
    }

    const batch = await this.resourceService.findManyByIds(salIds, { headers });

    response.included = { resources: batch.data };
    response.meta = {
      resources: {
        requested: batch.meta.requested,
        successful: batch.meta.successful,
        failed: batch.meta.failed,
        errors: batch.errors,
      },
    };
  }

  /**
   * Collects the de-duplicated set of serviceAtLocationId values from every
   * service on the org. These are the join keys into the `resources`
   * collection (`services[].SERVICE_AT_LOCATIONS[].ID`).
   */
  collectServiceAtLocationIds(
    organization: Pick<AggregatedOrganization, 'services'>,
  ): string[] {
    const ids = new Set<string>();
    for (const service of organization.services ?? []) {
      for (const sal of service.SERVICE_AT_LOCATIONS ?? []) {
        if (sal?.ID) ids.add(sal.ID);
      }
    }
    return [...ids];
  }
}
