import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { Resource } from 'src/common/schemas/resource.schema';
import { Model } from 'mongoose';
import { Redirect } from 'src/common/schemas/redirect.schema';

@Injectable()
export class ResourceService {
  constructor(
    @InjectModel(Resource.name) private resourceModel: Model<Resource>,
    @InjectModel(Redirect.name) private redirectModel: Model<Redirect>,
  ) {}

  async findById(id: string, options: { headers: HeadersDto }) {
    const resource = await this.resourceModel.findById(id, {
      noop: 0,
      translations: {
        $elemMatch: {
          locale: options.headers['accept-language'],
        },
      },
    });

    // If the resource wasn't found, we should check to see if a redirect exists
    // for this resource. If it does, we should redirect the user to the new
    // resource.
    if (!resource) {
      const redirect = await this.redirectModel.findById(id);

      if (redirect) {
        throw new NotFoundException({
          redirect: `/search/${redirect.newId}`,
        });
      }

      throw new NotFoundException();
    }

    // If the resource wasn't found, or if there are no translations for the
    // resource, we should return a 404.
    if (!resource || resource.translations.length === 0)
      throw new BadRequestException();

    const newV = resource.toJSON() as any;
    newV.translation = resource.translations[0];
    delete newV.translations;

    return newV;
  }
}
