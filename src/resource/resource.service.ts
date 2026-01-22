import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { Resource, ResourceDocument } from 'src/common/schemas/resource.schema';
import { Model, FilterQuery } from 'mongoose';
import { Redirect } from 'src/common/schemas/redirect.schema';

@Injectable()
export class ResourceService {
  private readonly logger: Logger;

  constructor(
    @InjectModel(Resource.name) private resourceModel: Model<Resource>,
    @InjectModel(Redirect.name) private redirectModel: Model<Redirect>,
  ) {
    this.logger = new Logger(ResourceService.name);
  }

  async findById(id: string, options: { headers: HeadersDto }) {
    return this.findResourceAndTransform({ _id: id }, id, options);
  }

  async findByOriginalId(id: string, options: { headers: HeadersDto }) {
    return this.findResourceAndTransform({ originalId: id }, id, options);
  }
  /**
   * Centralized logic for finding, filtering, and transforming the resource.
   */
  private async findResourceAndTransform(
    matchQuery: FilterQuery<Resource>,
    lookupId: string,
    options: { headers: HeadersDto },
  ) {
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

    const resource = results[0] as ResourceDocument & { _id: string };

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

    // Extract specific translations from the filtered result
    const userTranslation = resource.translations.find(
      (t: any) => t.locale === locale,
    );
    const enTranslation = resource.translations.find(
      (t: any) => t.locale === 'en',
    );

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
