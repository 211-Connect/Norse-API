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
import { ResourceTitleSnapshot } from 'src/common/schemas/resource-title-snapshot.schema';
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

interface ResourceTitleFields {
  serviceAtLocationId?: string | null;
  tenant_id?: string;
  displayName?: string | null;
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
    @InjectModel(ResourceTitleSnapshot.name)
    private readonly titleSnapshotModel: Model<ResourceTitleSnapshot>,
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

  /**
   * Resolves display names for the given resource ids.
   *
   * Two tiers, in order:
   *   1. live: one tenant-scoped lookup covering both id forms —
   *      `serviceAtLocationId`, and the legacy mongo `_id`. Every hit is also
   *      snapshotted (best-effort, keyed by the resource's own
   *      `serviceAtLocationId`) so tier 2 keeps working once it is gone.
   *   2. snapshot: the resource is no longer in `Resource` at all (deleted or
   *      no longer ingested) — use the last-known title recorded while it was
   *      still resolvable, so historical analytics do not show a bare id.
   *
   * Ids that resolve by neither are omitted; callers decide how to display
   * those (analytics falls back to the raw id). See
   * docs/resource-title-snapshots.md.
   */
  async findTitlesByIds(
    ids: string[],
    tenantId?: string,
  ): Promise<{ id: string; displayName: string }[]> {
    const requestedIds = new Set(ids);
    const uniqueIds = [...requestedIds];
    const titles: { id: string; displayName: string }[] = [];
    const foundIds = new Set<string>();
    const snapshots: ResourceTitleFields[] = [];
    const tenantFilter = tenantId ? { tenant_id: tenantId } : {};

    const resources = await this.resourceModel
      .find(
        {
          ...tenantFilter,
          $or: [
            { serviceAtLocationId: { $in: uniqueIds } },
            { _id: { $in: uniqueIds } },
          ],
        },
        { _id: 1, serviceAtLocationId: 1, displayName: 1, tenant_id: 1 },
      )
      .lean()
      .exec();

    for (const resource of resources) {
      // One document can satisfy its serviceAtLocationId, its legacy _id, or
      // both, so resolve every requested id it matches.
      const matchedIds = [resource.serviceAtLocationId, resource._id].filter(
        (id): id is string => !!id && requestedIds.has(id),
      );

      for (const id of matchedIds) {
        if (foundIds.has(id)) continue;

        if (id !== resource.serviceAtLocationId) {
          this.logFallbackLookup({
            tenantId,
            serviceAtLocationId: id,
            mongoId: resource._id,
            handler: 'findTitlesByIds',
            lookupPath: 'fallback',
          });
        }

        foundIds.add(id);
        titles.push({ id, displayName: resource.displayName });
      }

      // Snapshotted under the resource's own serviceAtLocationId, never a
      // requested legacy _id: those are answered by the live lookup or not at
      // all.
      snapshots.push(resource);
    }

    const unresolvedIds = uniqueIds.filter((id) => !foundIds.has(id));
    if (unresolvedIds.length > 0) {
      const snapshotResults = await this.titleSnapshotModel
        .find(
          { ...tenantFilter, serviceAtLocationId: { $in: unresolvedIds } },
          { serviceAtLocationId: 1, displayName: 1 },
        )
        .lean()
        .exec();

      for (const snapshot of snapshotResults) {
        const requestedId = snapshot.serviceAtLocationId;
        if (foundIds.has(requestedId)) continue;
        foundIds.add(requestedId);
        titles.push({
          id: requestedId,
          displayName: snapshot.displayName,
        });
      }
    }

    this.recordTitleSnapshots(snapshots);

    return titles;
  }

  /**
   * Best-effort persistence of resolved resource titles, so historical
   * analytics can still label a resource after it leaves the `Resource`
   * collection. Never awaited on a read path and never throws — a failed
   * snapshot must not fail the request.
   *
   * Rows are keyed by the resource's own `serviceAtLocationId`, so entries
   * without one (a resource that only exists under a mongo `_id`) are skipped:
   * those ids are answered by the live lookup instead.
   */
  private recordTitleSnapshots(entries: ResourceTitleFields[]): void {
    if (entries.length === 0) return;

    const deduped = new Map<string, ResourceTitleFields>();
    for (const entry of entries) {
      if (!entry.serviceAtLocationId || !entry.displayName) continue;
      deduped.set(
        `${entry.tenant_id ?? ''}:${entry.serviceAtLocationId}`,
        entry,
      );
    }
    if (deduped.size === 0) return;

    const operations = [...deduped.values()].map((entry) => ({
      updateOne: {
        filter: {
          tenant_id: entry.tenant_id ?? null,
          serviceAtLocationId: entry.serviceAtLocationId,
        },
        update: { $set: { displayName: entry.displayName } },
        upsert: true,
      },
    }));

    void this.titleSnapshotModel
      .bulkWrite(operations, { ordered: false })
      .catch((error: unknown) => {
        this.logger.warn(
          `Failed to snapshot resource titles: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
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

      this.recordTitleSnapshots([resource]);

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

    this.recordTitleSnapshots([resource]);

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
    const snapshots: ResourceTitleFields[] = [];

    for (const resource of resources) {
      const requestedId = resolveId(resource);
      foundIds.add(requestedId);
      snapshots.push(resource);

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

    this.recordTitleSnapshots(snapshots);
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
