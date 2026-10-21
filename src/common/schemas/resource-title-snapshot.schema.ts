import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ResourceTitleSnapshotDocument =
  HydratedDocument<ResourceTitleSnapshot>;

@Schema({ timestamps: true, collection: 'resourceTitleSnapshots' })
export class ResourceTitleSnapshot {
  @Prop({ required: true })
  serviceAtLocationId: string;

  @Prop({ index: true, name: 'tenant_id' })
  tenant_id: string;

  @Prop()
  displayName: string;
}

export const ResourceTitleSnapshotSchema = SchemaFactory.createForClass(
  ResourceTitleSnapshot,
);

ResourceTitleSnapshotSchema.index(
  { tenant_id: 1, serviceAtLocationId: 1 },
  { unique: true },
);
