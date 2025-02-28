import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { Resource, ResourceDocument } from 'src/common/schemas/resource.schema';
import { Model } from 'mongoose';
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
    let resource: ResourceDocument | null;
    const locale = options.headers['accept-language'];

    try {
      resource = await this.resourceModel
        .findById(id, {
          noop: 0,
          translations: {
            $elemMatch: {
              locale: locale,
            },
          },
        })
        .exec();
    } catch (e) {
      this.logger.error(e);
      throw new BadRequestException();
    }

    this.logger.debug(`Resource id=${id}, data=${resource}`);

    // If the resource wasn't found, we should check to see if a redirect exists
    // for this resource. If it does, we should redirect the user to the new
    // resource.
    if (!resource) {
      const redirect = await this.redirectModel.findById(id).exec();

      if (redirect) {
        throw new NotFoundException({
          redirect: `/search/${redirect.newId}`,
        });
      }

      throw new NotFoundException();
    }

    // If the resource wasn't found, or if there are no translations for the
    // resource, we should return a 404.
    if (!resource.translations || resource.translations.length === 0) {
      this.logger.debug(`Resource id=${id} has no translations`);
      throw new BadRequestException();
    }

    const newV = resource.toJSON() as any;
    newV.translation = resource.translations[0];
    delete newV.translations;

    return newV;
  }

  async findByOriginalId(id: string, options: { headers: HeadersDto }) {
    let resource: ResourceDocument | null;
    const locale = options.headers['accept-language'];

    try {
      resource = await this.resourceModel
        .findOne(
          { originalId: id },
          {
            noop: 0,
            translations: {
              $elemMatch: {
                locale: locale,
              },
            },
          },
        )
        .exec();
    } catch (e) {
      this.logger.error(e);
      throw new BadRequestException();
    }

    this.logger.debug(`Resource originalId=${id}, data=${resource}`);

    // If the resource wasn't found, we should check to see if a redirect exists
    // for this resource. If it does, we should redirect the user to the new
    // resource.  This is a crucial step!
    if (!resource) {
      const redirect = await this.redirectModel.findById(id).exec(); // check for redirects using the original ID

      if (redirect) {
        throw new NotFoundException({
          redirect: `/search/${redirect.newId}`, // redirect the user to the resource that the "normal" id links to
        });
      }

      throw new NotFoundException();
    }

    // If the resource wasn't found, or if there are no translations for the
    // resource, we should return a 404.
    if (!resource.translations || resource.translations.length === 0) {
      this.logger.debug(`Resource originalId=${id} has no translations`);
      throw new BadRequestException();
    }

    const newV = resource.toJSON() as any;
    newV.translation = resource.translations[0];
    delete newV.translations;

    return newV;
  }
}
