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
    return this.findResourceAndTransform({ _id: id }, id, options);
  }

  async findByOriginalId(
    id: string,
    options: { headers: HeadersDto },
  ): Promise<TransformedResource> {
    return this.findResourceAndTransform({ originalId: id }, id, options);
  }

  async findTitlesByIds(
    ids: string[],
  ): Promise<{ id: string; displayName: string }[]> {
    const resources = await this.resourceModel
      .find({ _id: { $in: ids } }, { _id: 1, displayName: 1 })
      .lean()
      .exec();

    return resources.map((r) => ({
      id: r._id,
      displayName: r.displayName,
    }));
  }

  /**
   * Batch fetch resources by IDs with partial failure support.
   * Returns a structured response with successful resources and errors.
   * Optimized to use a single MongoDB query instead of N queries.
   */
  async findManyByIds(
    ids: string[],
    options: { headers: HeadersDto },
  ): Promise<ResourceBatchResponse> {
    const uniqueIds = [...new Set(ids)]; // Deduplicate IDs
    const locale = options.headers['accept-language'];
    const data: Record<string, TransformedResource> = {};
    const errors: ResourceBatchResponse['errors'] = [];

    // Single aggregation query to fetch all resources
    const results = await this.resourceModel
      .aggregate([
        { $match: { _id: { $in: uniqueIds } } },
        {
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
        },
      ])
      .exec();

    // Create a Set of found IDs for quick lookup
    const foundIds = new Set<string>();

    // Process found resources
    for (const resource of results) {
      const resourceId = resource._id;
      foundIds.add(resourceId);

      try {
        const transformed = this.transformResourceWithTranslations(
          resource,
          locale,
          resourceId,
        );
        data[resourceId] = transformed;
      } catch (error) {
        if (error instanceof BadRequestException) {
          errors.push({
            id: resourceId,
            reason: 'Translation not available for requested locale',
            statusCode: 400,
          });
        } else {
          throw error;
        }
      }
    }

    // Check for missing IDs and add to errors
    for (const id of uniqueIds) {
      if (!foundIds.has(id)) {
        // Check for redirects
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
   * Centralized logic for finding, filtering, and transforming the resource.
   */
  private async findResourceAndTransform(
    matchQuery: FilterQuery<Resource>,
    lookupId: string,
    options: { headers: HeadersDto },
  ): Promise<TransformedResource> {
    const locale = options.headers['accept-language'];

    // Perform Aggregation
    // Fetch the document and filter the translations array in the DB
    // to only return the user's locale and 'en' (for facets).
    const results = await this.resourceModel
      .aggregate([
        { $match: matchQuery },
        {
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
        },
      ])
      .exec();

    const resource = results[0];

    this.logger.debug(`Resource lookupId=${lookupId}, found=${!!resource}`);

    // Handle Not Found & Redirects
    if (!resource) {
      // Check for redirects using the ID passed (works for both _id and originalId contexts)
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

  /**
   * Shared transformation logic to construct the response with translation and facets.
   * Extracts the user's locale translation and English facets.
   */
  private transformResourceWithTranslations(
    resource: Omit<Resource, 'translations'> & {
      _id: string;
      translations: ResourceTranslation[];
    },
    locale: string,
    lookupId: string,
  ): TransformedResource {
    // Extract specific translations from the filtered result
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

    // Construct Response
    // Destructure to separate 'translations' (to be removed)
    // from 'resourceData' (the rest of the document fields).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { translations, ...resourceData } = resource;

    return {
      ...resourceData,
      translation: userTranslation,
      facetsEn: enTranslation?.facets || [],
    };
  }
}
