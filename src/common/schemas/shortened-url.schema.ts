import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ShortenedUrlDocument = HydratedDocument<ShortenedUrl>;

@Schema({ timestamps: true, collection: 'shortenedUrls' })
export class ShortenedUrl {
  @Prop({ required: true })
  originalUrl: string;

  @Prop({ required: true, unique: true })
  shortId: string;

  @Prop({ required: true })
  tenantId: string;
}

export const ShortenedUrlSchema = SchemaFactory.createForClass(ShortenedUrl);

// Create compound indexes for optimal performance
ShortenedUrlSchema.index({ originalUrl: 1, tenantId: 1 }, { unique: true });
ShortenedUrlSchema.index({ shortId: 1, tenantId: 1 }, { unique: true });
ShortenedUrlSchema.index({ tenantId: 1 }); // For tenant-specific queries

// Constraints:
// - all fields should be required: true to prevent incomplete documents
// - the shortId should have unique: true at the global level

// Compound Indexes:
// - { originalUrl: 1, tenantId: 1 }: Essential for the upsert operation in getOrCreateWithUpsert
// - { shortId: 1, tenantId: 1 }: Required for findById method and collision detection
// - { tenantId: 1 }: Useful for tenant-specific operations
