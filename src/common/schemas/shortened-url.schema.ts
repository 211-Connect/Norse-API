import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ShortenedUrlDocument = HydratedDocument<ShortenedUrl>;

@Schema({ timestamps: true, collection: 'shortenedUrls' })
export class ShortenedUrl {
  @Prop({ index: true })
  originalUrl: string;

  @Prop({ index: true })
  shortId: string;

  @Prop({ index: true })
  tenantId: string;
}

export const ShortenedUrlSchema = SchemaFactory.createForClass(ShortenedUrl);
