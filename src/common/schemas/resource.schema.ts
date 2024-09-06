import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ResourceDocument = HydratedDocument<Resource>;

@Schema()
export class Resource {
  @Prop()
  _id: string;
}

export const ResourceSchema = SchemaFactory.createForClass(Resource);
