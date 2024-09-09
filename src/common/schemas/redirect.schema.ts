import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RedirectDocument = HydratedDocument<Redirect>;

@Schema({ timestamps: true })
export class Redirect {
  @Prop()
  _id: string;

  @Prop({ index: true })
  newId: string;

  @Prop({ index: true })
  tenantId: string;
}

export const RedirectSchema = SchemaFactory.createForClass(Redirect);
