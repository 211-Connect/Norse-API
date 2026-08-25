import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { Organization } from 'src/common/schemas/organization.schema';
import { Redirect } from 'src/common/schemas/redirect.schema';
import {
  OrganizationDetail,
  OrganizationTranslation,
} from './types/organization-response.types';

type LookupPath = 'primary' | 'fallback' | 'fallback_no_tenant';

type AggregatedOrganization = Omit<Organization, 'translations'> & {
  _id: string;
  organizationId?: string;
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
  ) {}

  async findById(
    id: string,
    options: { headers: HeadersDto },
  ): Promise<OrganizationDetail> {
    const tenantId = options.headers['x-tenant-id'];
    const locale = options.headers['accept-language'];
    const organization = await this.findOrganizationWithFallback(
      id,
      tenantId,
      locale,
    );
    return this.transformOrganization(organization, locale);
  }

  // Mirrors ResourceService: organizationId -> mongo _id (legacy links) ->
  // cross-tenant organizationId (shared orgs), then redirect, then 404.
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

  // Org uses an upper-cased `LOCALE` key; keep the requested locale plus the
  // English canonical.
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

  // Lenient by design: a missing org description yields null rather than a 400.
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
}
