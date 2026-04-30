import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ShortenedUrlDocument = HydratedDocument<ShortenedUrl>;

@Schema({ timestamps: true, collection: 'shortenedUrls' })
export class ShortenedUrl {
  @Prop({ required: true })
  originalUrl: string;

  @Prop({ required: true, unique: true })
  shortId: string;
}

export const ShortenedUrlSchema = SchemaFactory.createForClass(ShortenedUrl);

// Keep originalUrl globally unique to match the tenantless short URL flow.
ShortenedUrlSchema.index({ originalUrl: 1 }, { unique: true });
