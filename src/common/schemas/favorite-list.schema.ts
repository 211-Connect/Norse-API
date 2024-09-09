import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
// import { Resource } from './resource.schema';

export type FavoriteListDocument = HydratedDocument<FavoriteList>;

@Schema({ timestamps: true, collection: 'favoriteLists' })
export class FavoriteList {
  @Prop()
  name: string;

  @Prop()
  description: string;

  @Prop({ default: 'PRIVATE' })
  privacy: 'PUBLIC' | 'PRIVATE';

  @Prop({ index: true })
  ownerId: string;

  @Prop({ index: true })
  tenantId: string;

  @Prop({ type: [{ type: mongoose.Schema.Types.String, ref: 'Resource' }] })
  favorites: string[];
}

export const FavoriteListSchema = SchemaFactory.createForClass(FavoriteList);
