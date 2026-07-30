import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { Resource } from 'src/common/schemas/resource.schema';
import { Model, FilterQuery } from 'mongoose';
import { Redirect } from 'src/common/schemas/redirect.schema';
import {
  TransformedResource,
  ResourceBatchResponse,
  ResourceTranslation,
} from './types/resource-response.types';

type LookupPath = 'primary' | 'fallback' | 'fallback_no_tenant';

interface FallbackLookupLogContext {
  tenantId?: string;
  serviceAtLocationId: string;
  mongoId: string;
  handler: string;
  lookupPath: Exclude<LookupPath, 'primary'>;
}

type AggregatedResource = Omit<Resource, 'translations'> & {
  _id: string;
  serviceAtLocationId?: string;
  translations: ResourceTranslation[];
};

@Injectable()
export class ResourceService {
  private readonly logger: Logger;

  constructor(
    @InjectModel(Resource.name) private resourceModel: Model<Resource>,
    @InjectModel(Redirect.name) private redirectModel: Model<Redirect>,
  ) {
    this.logger = new Logger(ResourceService.name);
  }

  async findById(
    id: string,
    options: { headers: HeadersDto },
  ): Promise<TransformedResource> {
    const tenantId = options.headers['x-tenant-id'];
    return this.findResourceBySalId(id, tenantId, 'findById', options);
  }

  async findByOriginalId(
    id: string,
    options: { headers: HeadersDto },
  ): Promise<TransformedResource> {
    const tenantId = options.headers['x-tenant-id'];
    return this.findResourceAndTransform(
      { tenant_id: tenantId, originalId: id },
      id,
      options,
    );
  }

  async findTitlesByIds(
    ids: string[],
    tenantId?: string,
  ): Promise<{ id: string; displayName: string }[]> {
    const uniqueIds = [...new Set(ids)];
    const titles: { id: string; displayName: string }[] = [];
    const foundIds = new Set<string>();
    const tenantFilter = tenantId ? { tenant_id: tenantId } : {};

    const primaryResults = await this.resourceModel
      .find(
        { ...tenantFilter, serviceAtLocationId: { $in: uniqueIds } },
        { serviceAtLocationId: 1, displayName: 1 },
      )
      .lean()
      .exec();

    for (const resource of primaryResults) {
      const requestedId = resource.serviceAtLocationId;
      foundIds.add(requestedId);
      titles.push({
        id: requestedId,
        displayName: resource.displayName,
      });
    }

    const missingIds = uniqueIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      const fallbackResults = await this.resourceModel
        .find(
          { tenant_id: tenantId, _id: { $in: missingIds } },
          { _id: 1, displayName: 1 },
        )
        .lean()
        .exec();

      for (const resource of fallbackResults) {
        this.logFallbackLookup({
          tenantId,
          serviceAtLocationId: resource._id,
          mongoId: resource._id,
          handler: 'findTitlesByIds',
          lookupPath: 'fallback',
        });
        titles.push({
          id: resource._id,
          displayName: resource.displayName,
        });
      }
    }

    return titles;
  }

  /**
   * Batch fetch resources by IDs with partial failure support.
   * Returns a structured response with successful resources and errors.
   * Optimized to use a single MongoDB query instead of N queries.
   *
   * Uses the same 3-tier fallback chain as findResourceBySalId:
   *   1. primary: tenant-scoped lookup by serviceAtLocationId.
   *   2. fallback: tenant-scoped lookup by mongo _id.
   *   3. fallback_no_tenant: cross-tenant lookup by serviceAtLocationId.
   */
  async findManyByIds(
    ids: string[],
    options: { headers: HeadersDto },
  ): Promise<ResourceBatchResponse> {
    const tenantId = options.headers['x-tenant-id'];
    const uniqueIds = [...new Set(ids)];
    const locale = options.headers['accept-language'];
    const data: Record<string, TransformedResource> = {};
    const errors: ResourceBatchResponse['errors'] = [];

    // Create a Set of found IDs for quick lookup
    const foundIds = new Set<string>();

    const primaryResults = await this.aggregateResources(
      { tenant_id: tenantId, serviceAtLocationId: { $in: uniqueIds } },
      locale,
    );

    this.collectTransformedResources(
      primaryResults,
      locale,
      data,
      errors,
      foundIds,
      (resource) => resource.serviceAtLocationId ?? resource._id,
    );

    const missingIdsAfterPrimary = uniqueIds.filter((id) => !foundIds.has(id));
    if (missingIdsAfterPrimary.length > 0) {
      const fallbackResults = await this.aggregateResources(
        { tenant_id: tenantId, _id: { $in: missingIdsAfterPrimary } },
        locale,
      );

      for (const resource of fallbackResults) {
        this.logFallbackLookup({
          tenantId,
          serviceAtLocationId: resource._id,
          mongoId: resource._id,
          handler: 'findManyByIds',
          lookupPath: 'fallback',
        });
      }

      this.collectTransformedResources(
        fallbackResults,
        locale,
        data,
        errors,
        foundIds,
        (resource) => resource._id,
      );
    }

    const missingIdsAfterFallback = uniqueIds.filter((id) => !foundIds.has(id));
    if (missingIdsAfterFallback.length > 0) {
      const fallbackNoTenantResults = await this.aggregateResources(
        { serviceAtLocationId: { $in: missingIdsAfterFallback } },
        locale,
      );

      for (const resource of fallbackNoTenantResults) {
        this.logFallbackLookup({
          tenantId,
          serviceAtLocationId: resource.serviceAtLocationId!,
          mongoId: resource._id,
          handler: 'findManyByIds',
          lookupPath: 'fallback_no_tenant',
        });
      }

      this.collectTransformedResources(
        fallbackNoTenantResults,
        locale,
        data,
        errors,
        foundIds,
        (resource) => resource.serviceAtLocationId ?? resource._id,
      );
    }

    for (const id of uniqueIds) {
      if (!foundIds.has(id)) {
        const redirect = await this.redirectModel.findById(id).exec();

        if (redirect) {
          errors.push({
            id,
            reason: `Resource not found (redirect available: /search/${redirect.newId})`,
            statusCode: 404,
          });
        } else {
          errors.push({
            id,
            reason: 'Resource not found',
            statusCode: 404,
          });
        }
      }
    }

    return {
      data,
      errors,
      meta: {
        requested: ids.length,
        successful: Object.keys(data).length,
        failed: errors.length,
      },
    };
  }

  /**
   * Looks up a resource by its public-facing serviceAtLocationId (SAL) using a
   * 3-tier fallback chain:
   *   1. primary: tenant-scoped lookup by serviceAtLocationId.
   *   2. fallback: tenant-scoped lookup by mongo _id (legacy links that use
   *      the mongo id instead of the serviceAtLocationId).
   *   3. fallback_no_tenant: cross-tenant lookup by serviceAtLocationId, for
   *      resources that are intentionally shared/global across tenants.
   */
  private async findResourceBySalId(
    urlId: string,
    tenantId: string,
    handler: string,
    options: { headers: HeadersDto },
  ): Promise<TransformedResource> {
    const locale = options.headers['accept-language'];

    let results = await this.aggregateResources(
      {
        tenant_id: tenantId,
        serviceAtLocationId: urlId,
      },
      locale,
    );
    let lookupPath: LookupPath = 'primary';

    if (!results[0]) {
      results = await this.aggregateResources(
        { tenant_id: tenantId, _id: urlId },
        locale,
      );
      lookupPath = 'fallback';
    }

    if (!results[0]) {
      results = await this.aggregateResources(
        {
          serviceAtLocationId: urlId,
        },
        locale,
      );
      lookupPath = 'fallback_no_tenant';
    }

    const resource = results[0];

    if (resource) {
      if (lookupPath === 'primary') {
        this.logger.debug(
          `Resource lookup path=primary tenantId=${tenantId} serviceAtLocationId=${urlId} handler=${handler}`,
        );
      } else {
        this.logFallbackLookup({
          tenantId,
          serviceAtLocationId: urlId,
          mongoId: resource._id,
          handler,
          lookupPath,
        });
      }

      return this.transformResourceWithTranslations(resource, locale, urlId);
    }

    const redirect = await this.redirectModel.findById(urlId).exec();

    if (redirect) {
      throw new NotFoundException({
        redirect: `/search/${redirect.newId}`,
      });
    }

    throw new NotFoundException();
  }

  /**
   * Centralized logic for finding, filtering, and transforming the resource.
   */
  private async findResourceAndTransform(
    matchQuery: FilterQuery<Resource>,
    lookupId: string,
    options: { headers: HeadersDto },
  ): Promise<TransformedResource> {
    const locale = options.headers['accept-language'];
    const results = await this.aggregateResources(matchQuery, locale);
    const resource = results[0];

    this.logger.debug(`Resource lookupId=${lookupId}, found=${!!resource}`);

    if (!resource) {
      const redirect = await this.redirectModel.findById(lookupId).exec();

      if (redirect) {
        throw new NotFoundException({
          redirect: `/search/${redirect.newId}`,
        });
      }

      throw new NotFoundException();
    }

    return this.transformResourceWithTranslations(resource, locale, lookupId);
  }

  private async aggregateResources(
    matchQuery: FilterQuery<Resource>,
    locale: string,
  ): Promise<AggregatedResource[]> {
    return this.resourceModel
      .aggregate([
        { $match: matchQuery },
        this.buildTranslationFilterStage(locale),
      ])
      .exec();
  }

  private buildTranslationFilterStage(locale: string) {
    return {
      $addFields: {
        translations: {
          $filter: {
            input: '$translations',
            as: 't',
            cond: {
              $or: [
                { $eq: ['$$t.locale', locale] },
                { $eq: ['$$t.locale', 'en'] },
              ],
            },
          },
        },
      },
    };
  }

  private logFallbackLookup(context: FallbackLookupLogContext): void {
    this.logger.warn(
      `Resource lookup used ${context.lookupPath} path: ${JSON.stringify({
        lookupPath: context.lookupPath,
        tenantId: context.tenantId,
        serviceAtLocationId: context.serviceAtLocationId,
        mongoId: context.mongoId,
        handler: context.handler,
      })}`,
    );
  }

  /**
   * Shared batch-processing logic used by findManyByIds for both the primary
   * and fallback result sets: resolves each resource's requested id, marks it
   * as found, and transforms it, collecting per-resource errors instead of
   * throwing.
   */
  private collectTransformedResources(
    resources: AggregatedResource[],
    locale: string,
    data: Record<string, TransformedResource>,
    errors: ResourceBatchResponse['errors'],
    foundIds: Set<string>,
    resolveId: (resource: AggregatedResource) => string,
  ): void {
    for (const resource of resources) {
      const requestedId = resolveId(resource);
      foundIds.add(requestedId);

      try {
        data[requestedId] = this.transformResourceWithTranslations(
          resource,
          locale,
          requestedId,
        );
      } catch (error) {
        if (error instanceof BadRequestException) {
          errors.push({
            id: requestedId,
            reason: 'Translation not available for requested locale',
            statusCode: 400,
          });
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * Shared transformation logic to construct the response with translation and facets.
   * Extracts the user's locale translation and English facets.
   */
  private transformResourceWithTranslations(
    resource: AggregatedResource,
    locale: string,
    lookupId: string,
  ): TransformedResource {
    const userTranslation: ResourceTranslation | undefined =
      resource.translations.find((t) => t.locale === locale);
    const enTranslation: ResourceTranslation | undefined =
      resource.translations.find((t) => t.locale === 'en');

    if (!userTranslation) {
      this.logger.debug(
        `Resource lookupId=${lookupId} has no translation for ${locale}`,
      );
      throw new BadRequestException();
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { translations, ...resourceData } = resource;

    return {
      ...resourceData,
      translation: userTranslation,
      facetsEn: enTranslation?.facets || [],
    };
  }
}
