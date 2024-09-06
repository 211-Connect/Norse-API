import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { HeadersDto } from 'src/common/dto/headers.dto';
import { Resource } from 'src/common/schemas/resource.schema';
import { Model, Schema } from 'mongoose';

@Injectable()
export class ResourceService {
  constructor(
    @InjectModel(Resource.name) private resourceModel: Model<Resource>,
  ) {}

  async findById(id: string, options: { headers: HeadersDto }) {
    return this.resourceModel.findById(id);
  }
}
