import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { Resource } from 'src/common/schemas/resource.schema';
import { Model } from 'mongoose';

@Injectable()
export class ResourceService {
  constructor(
    @InjectModel(Resource.name) private resourceModel: Model<Resource>,
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
    // if (!resource) {
    //   const redirect = await Redirect.findById(id);

    //   if (redirect) {
    //     cacheControl(res);
    //     return res.status(404).json({
    //       redirect: `/search/${redirect.newId}`,
    //     });
    //   }
    // }

    // If the resource wasn't found, or if there are no translations for the
    // resource, we should return a 404.
    if (!resource || resource.translations.length === 0)
      throw new BadRequestException();

    const newV = resource.toJSON() as any;
    newV.translation = resource.translations[0];

    return newV;
  }
}
